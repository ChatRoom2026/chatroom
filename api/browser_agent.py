"""
ChatRoom 轻量级 AI 浏览器代理
- 使用 Playwright 控制浏览器，Ollama 本地模型做决策
- 零付费依赖，内存占用极低
- 端口: 3002
"""
import os
import sys
import json
import time
import uuid
import base64
import threading
import logging
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from typing import Optional

logging.basicConfig(level=logging.INFO, format='[browser-agent] %(message)s')
logger = logging.getLogger('browser-agent')

PORT = int(os.getenv('BROWSER_AGENT_PORT', '3002'))
CALLBACK_URL = os.getenv('BROWSER_CALLBACK_URL', 'http://localhost:3001/api/ai/callback')

# Ollama 配置
OLLAMA_BASE = os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'qwen3:0.6b')  # 最小模型，仅 ~400MB
MAX_STEPS_DEFAULT = int(os.getenv('BROWSER_MAX_STEPS', '8'))

# 任务存储
tasks: dict[str, dict] = {}
tasks_lock = threading.Lock()


def _call_ollama(messages: list[dict], tools: Optional[list[dict]] = None) -> dict:
    """调用 Ollama API（兼容 OpenAI 格式）"""
    import urllib.request
    import urllib.error

    payload = {
        'model': OLLAMA_MODEL,
        'messages': messages,
        'stream': False,
        'options': {'temperature': 0.1, 'num_predict': 512},
    }
    if tools:
        payload['tools'] = tools

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        f'{OLLAMA_BASE}/v1/chat/completions',
        data=data,
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.URLError as e:
        raise RuntimeError(f'Ollama 连接失败: {e}. 请确保 Ollama 已启动，模型 {OLLAMA_MODEL} 已拉取')


def _get_page_snapshot(page) -> str:
    """获取页面可交互元素快照（省 token，不需要视觉模型）"""
    try:
        snapshot = page.evaluate('''() => {
            const title = document.title || '';
            const url = location.href;
            const els = document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="menuitem"], [onclick], h1, h2, h3, h4, [tabindex]');
            const seen = new Set();
            const items = [];
            let idx = 0;
            els.forEach(el => {
                if (seen.has(el)) return;
                seen.add(el);
                const tag = el.tagName?.toLowerCase() || '';
                const type = el.type || '';
                const text = (el.textContent || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || '').trim().substring(0, 80);
                const id = el.id || '';
                const cls = (el.className && typeof el.className === 'string') ? el.className.split(' ').slice(0, 3).join('.') : '';
                const href = el.href || el.getAttribute('data-href') || '';
                const visible = el.offsetParent !== null;
                if (!visible) return;
                idx++;
                items.push(`${idx}. <${tag}${type ? ' type=' + type : ''}${id ? ' id=' + id : ''}${cls ? ' class=' + cls : ''}${href ? ' href=' + href.substring(0, 60) : ''}>${text}</${tag}>`);
                if (items.length >= 60) return;
            });
            return `URL: ${url}\\nTitle: ${title}\\n\\nInteractive elements:\\n${items.join('\\n')}`;
        }''')
        return snapshot or '(页面为空或无法解析)'
    except Exception as e:
        return f'(获取页面快照失败: {e})'


def _get_browser_tools() -> list[dict]:
    """返回 Ollama function calling 工具定义"""
    return [
        {
            'type': 'function',
            'function': {
                'name': 'browser_action',
                'description': '在浏览器中执行一个操作',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'action': {
                            'type': 'string',
                            'enum': ['navigate', 'click', 'type', 'scroll_down', 'scroll_up', 'go_back', 'extract', 'wait', 'done'],
                            'description': '要执行的操作'
                        },
                        'url': {'type': 'string', 'description': '导航目标 URL（action=navigate 时必填）'},
                        'selector': {'type': 'string', 'description': '元素编号（如 "3"）或 CSS 选择器（action=click/type 时使用）'},
                        'text': {'type': 'string', 'description': '要输入的文本（action=type 时必填）'},
                        'reason': {'type': 'string', 'description': '为什么执行这个操作'},
                        'result': {'type': 'string', 'description': '任务完成时的总结（action=done 时必填）'},
                    },
                    'required': ['action', 'reason']
                }
            }
        }
    ]


def _execute_action(page, browser, action: dict) -> str:
    """执行浏览器操作"""
    act = action.get('action', '')
    try:
        if act == 'navigate':
            url = action.get('url', '')
            if not url.startswith('http'):
                url = 'https://' + url
            page.goto(url, timeout=15000, wait_until='domcontentloaded')
            page.wait_for_timeout(1000)
            return f'已导航到: {page.url}'

        elif act == 'click':
            sel = str(action.get('selector', ''))
            # 如果是数字，用快照中的索引
            page.evaluate(f'''
                const idx = parseInt("{sel}");
                if (!isNaN(idx)) {{
                    const els = document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="menuitem"], [onclick]');
                    const visible = Array.from(els).filter(e => e.offsetParent !== null);
                    if (visible[idx - 1]) {{
                        visible[idx - 1].click();
                        return;
                    }}
                }}
                // fallback to CSS selector
                const el = document.querySelector("{sel}");
                if (el) el.click();
            ''')
            page.wait_for_timeout(1500)
            return f'已点击元素: {sel}'

        elif act == 'type':
            sel = str(action.get('selector', ''))
            text = action.get('text', '')
            page.evaluate(f'''
                const idx = parseInt("{sel}");
                if (!isNaN(idx)) {{
                    const els = document.querySelectorAll('input, textarea, select, [role="textbox"], [role="combobox"]');
                    const visible = Array.from(els).filter(e => e.offsetParent !== null);
                    if (visible[idx - 1]) {{
                        const el = visible[idx - 1];
                        el.focus();
                        el.value = '';
                        el.value = {json.dumps(text)};
                        el.dispatchEvent(new Event("input", {{bubbles: true}}));
                        return;
                    }}
                }}
                const el = document.querySelector("{sel}");
                if (el) {{
                    el.focus();
                    el.value = '';
                    el.value = {json.dumps(text)};
                    el.dispatchEvent(new Event("input", {{bubbles: true}}));
                }}
            ''')
            page.wait_for_timeout(500)
            return f'已输入文本到: {sel}'

        elif act == 'scroll_down':
            page.evaluate('window.scrollBy(0, 500)')
            page.wait_for_timeout(500)
            return '已向下滚动'

        elif act == 'scroll_up':
            page.evaluate('window.scrollBy(0, -500)')
            page.wait_for_timeout(500)
            return '已向上滚动'

        elif act == 'go_back':
            page.go_back(timeout=10000)
            page.wait_for_timeout(1000)
            return '已返回上一页'

        elif act == 'extract':
            text = page.evaluate('() => document.body?.innerText?.substring(0, 3000) || ""')
            return f'页面内容:\n{text}'

        elif act == 'wait':
            page.wait_for_timeout(2000)
            return '已等待 2 秒'

        elif act == 'done':
            return action.get('result', '任务完成')

        else:
            return f'未知操作: {act}'

    except Exception as e:
        return f'操作失败 ({act}): {e}'


def run_browser_task(task_id: str, task_desc: str, max_steps: int = MAX_STEPS_DEFAULT):
    """执行浏览器任务"""
    try:
        from playwright.sync_api import sync_playwright

        with tasks_lock:
            tasks[task_id]['status'] = 'running'
            tasks[task_id]['started_at'] = time.time()

        logger.info(f'[任务 {task_id}] 开始: {task_desc[:100]}')

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=[
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', '--disable-gpu',
                '--single-process',  # 省内存
            ])
            context = browser.new_context(
                viewport={'width': 1280, 'height': 720},
                user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
            )
            page = context.new_page()

            messages = [
                {
                    'role': 'system',
                    'content': (
                        '你是一个浏览器自动化助手。用户会给你一个任务，你需要逐步完成。'
                        '每个回合你会收到当前页面的元素快照，然后使用 browser_action 函数执行操作。'
                        '可用操作: navigate(导航到URL), click(点击元素), type(输入文本), '
                        'scroll_down(向下滚动), scroll_up(向上滚动), go_back(返回), '
                        'extract(提取页面文本), wait(等待), done(标记任务完成)。'
                        '尽量用元素编号来选择元素，编号在快照中每行开头。'
                        '在确定任务完成或无法继续时，使用 done 操作并给出总结。'
                    )
                },
                {
                    'role': 'user',
                    'content': f'任务: {task_desc}\n\n首先，请导航到一个合适的网站开始执行任务。'
                    '如果任务中提到了具体网址，请直接导航过去。否则请使用搜索引擎。'
                }
            ]

            final_result = ''
            for step in range(max_steps):
                # 获取页面快照
                snapshot = _get_page_snapshot(page)
                messages.append({'role': 'user', 'content': f'当前页面:\n{snapshot}\n\n下一步操作？'})

                # 调用 Ollama
                resp = _call_ollama(messages, tools=_get_browser_tools())
                choice = resp.get('choices', [{}])[0]
                msg = choice.get('message', {})

                # 处理 tool call
                tool_calls = msg.get('tool_calls', [])
                if tool_calls:
                    tc = tool_calls[0]
                    func_name = tc.get('function', {}).get('name', '')
                    func_args = json.loads(tc.get('function', {}).get('arguments', '{}'))

                    if func_name == 'browser_action':
                        action = func_args
                    else:
                        action = func_args
                else:
                    # 没有 tool call，用文本回复
                    content = msg.get('content', '') or choice.get('text', '')
                    action = {'action': 'done', 'result': content, 'reason': '模型直接回复'}

                act = action.get('action', 'done')
                reason = action.get('reason', '')
                logger.info(f'[任务 {task_id}] 步骤 {step + 1}: {act} - {reason}')

                # 执行操作
                result = _execute_action(page, browser, action)

                # 将操作结果加入对话
                messages.append({
                    'role': 'assistant',
                    'content': None,
                    'tool_calls': [{
                        'id': f'call_{step}',
                        'type': 'function',
                        'function': {
                            'name': 'browser_action',
                            'arguments': json.dumps(action, ensure_ascii=False),
                        }
                    }]
                })
                messages.append({
                    'role': 'tool',
                    'tool_call_id': f'call_{step}',
                    'content': result,
                })

                if act == 'done':
                    final_result = action.get('result', result)
                    break
                elif act == 'navigate':
                    final_result = result

            if not final_result:
                final_result = f'达到最大步骤数 ({max_steps})，当前页面: {page.url}'

            context.close()
            browser.close()

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
    """通知 Node.js 后端任务结果"""
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
                'model': OLLAMA_MODEL,
                'ollama': OLLAMA_BASE,
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
                    tid: {
                        'status': t['status'],
                        'task': t['task'][:100],
                    }
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
            max_steps = data.get('max_steps', MAX_STEPS_DEFAULT)
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
                'message': '任务已接收，正在执行...',
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
    # 检查 Ollama 是否可用
    try:
        import urllib.request
        req = urllib.request.Request(f'{OLLAMA_BASE}/api/tags')
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            models = [m['name'] for m in data.get('models', [])]
            logger.info(f'Ollama 已连接，可用模型: {models}')
            if OLLAMA_MODEL not in models and not any(OLLAMA_MODEL in m for m in models):
                logger.warning(f'⚠ 模型 {OLLAMA_MODEL} 未找到，请先运行: ollama pull {OLLAMA_MODEL}')
    except Exception as e:
        logger.warning(f'⚠ 无法连接 Ollama ({OLLAMA_BASE}): {e}')
        logger.warning('请确保 Ollama 已安装并启动: curl -fsSL https://ollama.com/install.sh | sh')

    server = HTTPServer(('0.0.0.0', PORT), AgentHandler)
    logger.info(f'轻量 Browser Agent 已启动，端口: {PORT}，模型: {OLLAMA_MODEL}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        logger.info('服务已停止')


if __name__ == '__main__':
    main()