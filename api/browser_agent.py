"""
ChatRoom 轻量级浏览器代理
- 纯 Playwright，零 LLM 依赖，极低内存
- 支持自然语言命令解析（搜索、打开网页、截图、提取内容等）
- 端口: 3002
"""
import os
import sys
import json
import time
import uuid
import re
import threading
import logging
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from urllib.parse import quote

logging.basicConfig(level=logging.INFO, format='[browser-agent] %(message)s')
logger = logging.getLogger('browser-agent')

PORT = int(os.getenv('BROWSER_AGENT_PORT', '3002'))
CALLBACK_URL = os.getenv('BROWSER_CALLBACK_URL', 'http://localhost:3001/api/ai/callback')
MAX_STEPS = int(os.getenv('BROWSER_MAX_STEPS', '5'))

# 任务存储
tasks: dict[str, dict] = {}
tasks_lock = threading.Lock()

# 默认搜索引擎
SEARCH_ENGINE = 'https://www.baidu.com/s?wd={query}'


def parse_command(task: str) -> list[dict]:
    """解析自然语言命令为操作序列"""
    task_lower = task.lower().strip()
    actions = []

    # 提取 URL
    url_match = re.search(r'(https?://[^\s，,。]+)', task)
    if url_match:
        url = url_match.group(1)
        # 去除 URL 中的引号
        url = url.strip('\'"')
        actions.append({'action': 'navigate', 'url': url})
        # 提取导航后的操作
        remaining = task.replace(url_match.group(1), '').strip()
        if remaining:
            sub_actions = _parse_remaining(remaining)
            actions.extend(sub_actions)
        return actions if actions else [{'action': 'navigate', 'url': url}]

    # 搜索命令
    search_patterns = [
        r'(?:搜索|查|搜|百度|google|帮我找|帮我查|查找|搜索一下)(?:一下|下)?[：:\s]*(.+)',
        r'(.+)(?:是什么|什么意思|怎么样|怎么(?:样|办))',
    ]
    for pat in search_patterns:
        m = re.search(pat, task_lower)
        if m:
            query = m.group(1).strip()
            if query:
                actions.append({'action': 'search', 'query': query})
                return actions

    # 打开网页
    site_patterns = [
        (r'(?:打开|去|访问|浏览|看(?:一下|看)?)(?:网站|网页)?[：:\s]*(.+)', 'navigate'),
    ]
    for pat, act in site_patterns:
        m = re.search(pat, task_lower)
        if m:
            target = m.group(1).strip()
            if '.' in target:
                url = target if target.startswith('http') else f'https://{target}'
                actions.append({'action': 'navigate', 'url': url})
            else:
                actions.append({'action': 'search', 'query': target})
            return actions

    # 截图
    if re.search(r'(截图|截屏|screenshot|capture)', task_lower):
        actions.append({'action': 'screenshot'})
        return actions

    # 默认：当作搜索
    if task.strip():
        actions.append({'action': 'search', 'query': task.strip()})
    return actions


def _parse_remaining(text: str) -> list[dict]:
    """解析剩余操作"""
    actions = []
    text = text.strip().lstrip('，,。').strip()

    # 点击
    click_match = re.search(r'(?:点击|按下|按|click)[：:\s]*(.+)', text, re.IGNORECASE)
    if click_match:
        target = click_match.group(1).strip().rstrip('，,。')
        actions.append({'action': 'click_text', 'text': target})

    # 输入
    type_match = re.search(r'(?:输入|填写|键入|type)[：:\s]*(.+)', text, re.IGNORECASE)
    if type_match:
        content = type_match.group(1).strip().rstrip('，,。')
        actions.append({'action': 'type_text', 'text': content})

    # 提取
    if re.search(r'(?:提取|获取|抓取|extract|内容)', text, re.IGNORECASE):
        actions.append({'action': 'extract'})

    if not actions:
        actions.append({'action': 'extract'})
    return actions


def run_browser_task(task_id: str, task_desc: str, max_steps: int = MAX_STEPS):
    """执行浏览器任务"""
    try:
        from playwright.sync_api import sync_playwright

        with tasks_lock:
            tasks[task_id]['status'] = 'running'
            tasks[task_id]['started_at'] = time.time()

        logger.info(f'[任务 {task_id}] 开始: {task_desc[:100]}')

        actions = parse_command(task_desc)
        logger.info(f'[任务 {task_id}] 解析操作: {json.dumps(actions, ensure_ascii=False)}')

        if not actions:
            with tasks_lock:
                tasks[task_id]['status'] = 'failed'
                tasks[task_id]['error'] = '无法解析任务命令'
            _notify_callback(task_id, 'failed', '无法解析任务命令')
            return

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=[
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', '--disable-gpu',
                '--single-process',
            ])
            context = browser.new_context(
                viewport={'width': 1280, 'height': 720},
                user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
            )
            page = context.new_page()
            results = []

            for i, action in enumerate(actions[:max_steps]):
                act = action.get('action', '')
                logger.info(f'[任务 {task_id}] 步骤 {i + 1}: {act}')

                try:
                    if act == 'navigate':
                        url = action.get('url', '')
                        if not url.startswith('http'):
                            url = 'https://' + url
                        page.goto(url, timeout=20000, wait_until='domcontentloaded')
                        page.wait_for_timeout(1500)
                        results.append(f'已打开: {page.url}')

                    elif act == 'search':
                        query = action.get('query', '')
                        search_url = SEARCH_ENGINE.format(query=quote(query))
                        page.goto(search_url, timeout=15000, wait_until='domcontentloaded')
                        page.wait_for_timeout(2000)
                        # 尝试提取搜索结果
                        try:
                            title = page.title()
                            snippets = page.evaluate('''() => {
                                const results = [];
                                document.querySelectorAll('h3, .t, .result h3 a, [class*="result"] h3').forEach((el, i) => {
                                    if (i < 5) results.push(el.textContent?.trim());
                                });
                                return results.filter(Boolean);
                            }''')
                            results.append(f'搜索 "{query}" 完成')
                            if snippets:
                                results.append('搜索结果:\n' + '\n'.join(f'  {i+1}. {s}' for i, s in enumerate(snippets)))
                        except Exception:
                            results.append(f'搜索 "{query}" 完成，页面: {page.url}')

                    elif act == 'click_text':
                        text = action.get('text', '')
                        try:
                            # 尝试点击包含指定文本的元素
                            page.evaluate(f'''
                                const text = {json.dumps(text)};
                                const els = document.querySelectorAll('a, button, [role="button"], input[type="submit"], h3');
                                for (const el of els) {{
                                    if (el.textContent?.includes(text) || el.value?.includes(text)) {{
                                        el.click();
                                        return;
                                    }}
                                }}
                            ''')
                            page.wait_for_timeout(2000)
                            results.append(f'已点击: {text}')
                        except Exception:
                            results.append(f'点击失败: {text}')

                    elif act == 'type_text':
                        text = action.get('text', '')
                        try:
                            page.evaluate(f'''
                                const text = {json.dumps(text)};
                                const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea, [role="textbox"]');
                                for (const el of inputs) {{
                                    if (el.offsetParent !== null) {{
                                        el.focus();
                                        el.value = text;
                                        el.dispatchEvent(new Event("input", {{bubbles: true}}));
                                        return;
                                    }}
                                }}
                            ''')
                            page.wait_for_timeout(500)
                            # 尝试提交
                            page.evaluate('''
                                const form = document.querySelector('form');
                                if (form) form.submit();
                            ''')
                            page.wait_for_timeout(2000)
                            results.append(f'已输入: {text}')
                        except Exception:
                            results.append(f'输入失败: {text}')

                    elif act == 'extract':
                        page.wait_for_timeout(1000)
                        text = page.evaluate('() => document.body?.innerText?.substring(0, 3000) || ""')
                        results.append(f'页面内容:\n{text}')

                    elif act == 'screenshot':
                        page.wait_for_timeout(1000)
                        screenshot = page.screenshot(full_page=False, type='jpeg', quality=60)
                        import base64
                        data_url = f'data:image/jpeg;base64,{base64.b64encode(screenshot).decode()}'
                        # 保存截图到文件
                        import tempfile
                        fname = f'/opt/chatroom/uploads/screenshot_{task_id}.jpg'
                        os.makedirs('/opt/chatroom/uploads', exist_ok=True)
                        with open(fname, 'wb') as f:
                            f.write(screenshot)
                        results.append(f'截图已保存: /uploads/screenshot_{task_id}.jpg')

                except Exception as e:
                    results.append(f'操作失败 ({act}): {e}')

            context.close()
            browser.close()

        final_result = '\n\n'.join(results) if results else '无结果'

        with tasks_lock:
            tasks[task_id]['status'] = 'completed'
            tasks[task_id]['result'] = final_result
            tasks[task_id]['finished_at'] = time.time()

        _notify_callback(task_id, 'completed', final_result)
        logger.info(f'[任务 {task_id}] 完成: {final_result[:200]}')

    except Exception as e:
        logger.error(f'[任务 {task_id}] 失败: {traceback.format_exc()}')
        with tasks_lock:
            tasks[task_id]['status'] = 'failed'
            tasks[task_id]['error'] = str(e)
        _notify_callback(task_id, 'failed', str(e))


def _notify_callback(task_id: str, status: str, result: str):
    """通知 Node.js 后端"""
    import urllib.request
    try:
        data = json.dumps({
            'task_id': task_id,
            'status': status,
            'result': result[:4000] if result else '',
        }).encode('utf-8')
        req = urllib.request.Request(
            CALLBACK_URL,
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        logger.error(f'回调失败: {e}')


class AgentHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        logger.info(format % args)

    def _send_json(self, data: dict, status: int = 200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/health':
            self._send_json({
                'status': 'ok',
                'tasks_count': len(tasks),
                'engine': 'playwright-direct',
                'mode': 'lightweight-command-parser',
            })

        elif parsed.path.startswith('/status/'):
            task_id = parsed.path.split('/')[-1]
            with tasks_lock:
                task = tasks.get(task_id)
            if task:
                self._send_json({
                    'task_id': task_id,
                    'status': task['status'],
                    'result': task.get('result', ''),
                    'error': task.get('error', ''),
                })
            else:
                self._send_json({'error': '任务不存在'}, 404)

        elif parsed.path == '/tasks':
            with tasks_lock:
                task_list = {
                    tid: {'status': t['status'], 'task': t['task'][:100]}
                    for tid, t in tasks.items()
                }
            self._send_json({'tasks': task_list})

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/run':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._send_json({'error': '无效的 JSON'}, 400)
                return

            task_desc = data.get('task', '')
            max_steps = data.get('max_steps', MAX_STEPS)
            user_id = data.get('user_id', '')
            source = data.get('source', 'chat')
            target_id = data.get('target_id', '')

            if not task_desc:
                self._send_json({'error': '请提供任务描述'}, 400)
                return

            task_id = str(uuid.uuid4())[:8]
            with tasks_lock:
                tasks[task_id] = {
                    'task': task_desc,
                    'status': 'pending',
                    'user_id': user_id,
                    'source': source,
                    'target_id': target_id,
                    'created_at': time.time(),
                }

            thread = threading.Thread(
                target=run_browser_task,
                args=(task_id, task_desc, max_steps),
                daemon=True,
            )
            thread.start()

            self._send_json({
                'task_id': task_id,
                'status': 'pending',
                'message': '任务已接收',
            })

        elif parsed.path == '/stop':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._send_json({'error': '无效的 JSON'}, 400)
                return

            task_id = data.get('task_id', '')
            with tasks_lock:
                task = tasks.get(task_id)
                if task and task['status'] in ('pending', 'running'):
                    task['status'] = 'stopped'
                    self._send_json({'task_id': task_id, 'status': 'stopped'})
                else:
                    self._send_json({'error': '任务不存在或已完成'}, 404)

        else:
            self._send_json({'error': 'Not found'}, 404)


def main():
    server = HTTPServer(('0.0.0.0', PORT), AgentHandler)
    logger.info(f'轻量浏览器代理已启动，端口: {PORT} (命令解析模式，零 LLM 依赖)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        logger.info('服务已停止')


if __name__ == '__main__':
    main()