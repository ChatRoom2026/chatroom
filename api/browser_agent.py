"""
ChatRoom 浏览器代理 - subprocess 隔离 + GitHub Models 免费 AI
端口: 3002
"""
import os, sys, json, time, uuid, re, threading, logging, traceback, subprocess, tempfile, socket, socketserver
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, quote

# 读取 .env 文件
env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
if os.path.exists(env_file):
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

logging.basicConfig(level=logging.INFO, format='[browser-agent] %(message)s')
logger = logging.getLogger('browser-agent')

PORT = int(os.getenv('BROWSER_AGENT_PORT', '3002'))
CALLBACK_URL = os.getenv('BROWSER_CALLBACK_URL', 'http://localhost:3001/api/ai/callback')
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN', '')
AI_MODEL = os.getenv('AI_MODEL', 'gpt-4o-mini')
API_URL = 'https://models.inference.ai.azure.com/chat/completions'
MAX_STEPS = 5

tasks: dict[str, dict] = {}
tasks_lock = threading.Lock()


def call_ai(messages: list[dict]) -> str:
    """调用 GitHub Models API"""
    import urllib.request
    data = json.dumps({
        'model': AI_MODEL,
        'messages': messages,
        'temperature': 0.3,
        'max_tokens': 800,
    }).encode('utf-8')
    req = urllib.request.Request(API_URL, data=data, headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {GITHUB_TOKEN}',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            return result['choices'][0]['message']['content']
    except Exception as e:
        raise RuntimeError(f'AI API 调用失败: {e}')

# ---- 子进程隔离的浏览器任务 ----
BROWSER_WORKER_SCRIPT = """
import os, sys, json, time
from playwright.sync_api import sync_playwright
from urllib.parse import quote

task_desc = os.environ["TASK_DESC"]
task_id = os.environ["TASK_ID"]
output_file = os.environ["OUTPUT_FILE"]
max_steps = int(os.environ.get("MAX_STEPS", "5"))

SEARCH_ENGINE = "https://www.baidu.com/s?wd={query}"

def get_snapshot(page):
    try:
        return page.evaluate('''() => {
            const title = document.title || "";
            const url = location.href;
            const items = [];
            const els = document.querySelectorAll("a, button, input, textarea, select, [role=button], [role=link], [role=textbox], [role=combobox], h1, h2, h3, [onclick]");
            let idx = 0;
            const seen = new Set();
            els.forEach(el => {
                if (seen.has(el) || !el.offsetParent) return;
                seen.add(el);
                idx++;
                const tag = el.tagName?.toLowerCase() || "";
                const text = (el.textContent || el.value || el.placeholder || el.getAttribute("aria-label") || "").trim().substring(0, 60);
                const href = el.href || "";
                if (idx <= 40) items.push(idx + ". <" + tag + (href ? " href=" + href.substring(0, 50) : "") + ">" + text + "</" + tag + ">");
            });
            return "URL: " + url + "\\nTitle: " + title + "\\n\\nElements:\\n" + items.join("\\n");
        }''') or "(empty)"
    except:
        return "(snapshot error)"

def execute(page, action_str):
    try:
        action = json.loads(action_str)
        act = action.get("action", "")
        if act == "navigate":
            url = action.get("url", "")
            if not url.startswith("http"):
                url = "https://" + url
            page.goto(url, timeout=15000, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            return "OK: navigated to " + page.url
        elif act == "search":
            q = action.get("query", "")
            page.goto(SEARCH_ENGINE.format(query=quote(q)), timeout=15000, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            try:
                items = page.evaluate('''() => {
                    const r = [];
                    document.querySelectorAll(".result, .c-container, [class*=result]").forEach((c, i) => {
                        if (i >= 5) return;
                        const t = c.querySelector("h3 a, h3")?.textContent?.trim() || "";
                        const s = c.querySelector(".c-abstract, [class*=abstract]")?.textContent?.trim()?.substring(0, 200) || "";
                        const l = c.querySelector("a[href*=\\"http\\"]")?.href || "";
                        if (t) r.push({title: t, snippet: s, link: l});
                    });
                    if (!r.length) {
                        document.querySelectorAll("h3").forEach((h, i) => {
                            if (i >= 5) return;
                            const p = h.nextElementSibling?.textContent?.trim()?.substring(0, 200) || "";
                            r.push({title: h.textContent?.trim(), snippet: p, link: h.querySelector("a")?.href || ""});
                        });
                    }
                    return r;
                }''')
                out = "Search results:\\n"
                for i, it in enumerate(items):
                    out += f"{i+1}. {it['title']}\\n   {it['snippet']}\\n   {it['link']}\\n"
                return out
            except:
                return "Search done: " + page.url
        elif act == "click":
            idx = action.get("index", 0)
            page.evaluate(f'''
                const els = document.querySelectorAll("a, button, input, [role=button], [role=link], [onclick]");
                const vis = Array.from(els).filter(e => e.offsetParent);
                if (vis[{idx - 1}]) vis[{idx - 1}].click();
            ''')
            page.wait_for_timeout(2000)
            return "OK: clicked element " + str(idx)
        elif act == "type":
            idx = action.get("index", 0)
            text = action.get("text", "")
            page.evaluate(f'''
                const els = document.querySelectorAll("input, textarea, [role=textbox]");
                const vis = Array.from(els).filter(e => e.offsetParent);
                if (vis[{idx - 1}]) {{
                    vis[{idx - 1}].focus();
                    vis[{idx - 1}].value = {json.dumps(text)};
                    vis[{idx - 1}].dispatchEvent(new Event("input", {{bubbles: true}}));
                }}
            ''')
            page.wait_for_timeout(500)
            page.evaluate('''() => { const f = document.querySelector("form"); if (f) f.submit(); }''')
            page.wait_for_timeout(2000)
            return "OK: typed text"
        elif act == "extract":
            page.wait_for_timeout(1000)
            text = page.evaluate('''() => document.body?.innerText?.substring(0, 4000) || ""''')
            return text
        elif act == "scroll":
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)
            return "OK: scrolled"
        elif act == "back":
            page.go_back(timeout=10000)
            page.wait_for_timeout(1000)
            return "OK: went back"
        elif act == "done":
            return "DONE: " + action.get("summary", "Task completed")
        return "Unknown action: " + act
    except Exception as e:
        return "ERROR: " + str(e)

try:
    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()

    # 初始搜索
    page.goto(SEARCH_ENGINE.format(query=quote(task_desc)), timeout=15000, wait_until="domcontentloaded")
    page.wait_for_timeout(2000)

    history = ""
    for step in range(max_steps):
        snapshot = get_snapshot(page)

        # 调用 AI（通过文件传递）
        prompt_file = "/tmp/ai_prompt_" + task_id + ".json"
        resp_file = "/tmp/ai_resp_" + task_id + ".json"
        with open(prompt_file, "w") as f:
            json.dump({"snapshot": snapshot, "task": task_desc, "history": history, "step": step}, f)

        # 等待主进程调用 AI 并写入结果
        for _ in range(60):
            if os.path.exists(resp_file):
                time.sleep(0.2)
                with open(resp_file) as f:
                    resp = json.load(f)
                os.remove(resp_file)
                break
            time.sleep(0.5)
        else:
            history += "\\nAI timeout"
            break

        action_str = resp.get("action", "{}")
        result = execute(page, action_str)
        history += f"\\nStep {step+1}: {result}"
        try:
            act = json.loads(action_str).get("action", "")
            if act == "done":
                break
        except:
            pass

    ctx.close()
    browser.close()
    pw.stop()

    with open(output_file, "w") as f:
        json.dump({"status": "completed", "result": history}, f)

except Exception as e:
    with open(output_file, "w") as f:
        json.dump({"status": "failed", "error": str(e)}, f)
"""


def run_browser_task(task_id: str, task_desc: str, max_steps: int = MAX_STEPS):
    """启动子进程执行浏览器任务"""
    try:
        with tasks_lock:
            tasks[task_id]['status'] = 'running'
            tasks[task_id]['started_at'] = time.time()

        output_file = f'/tmp/browser_result_{task_id}.json'
        prompt_file = f'/tmp/ai_prompt_{task_id}.json'
        resp_file = f'/tmp/ai_resp_{task_id}.json'

        # 清理旧文件
        for f in [output_file, prompt_file, resp_file]:
            try:
                os.remove(f)
            except:
                pass

        env = os.environ.copy()
        env['TASK_DESC'] = task_desc
        env['TASK_ID'] = task_id
        env['OUTPUT_FILE'] = output_file
        env['MAX_STEPS'] = str(max_steps)

        proc = subprocess.Popen(
            [sys.executable, '-c', BROWSER_WORKER_SCRIPT],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )

        logger.info(f'[任务 {task_id}] 子进程已启动 PID={proc.pid}')

        # 等待子进程发送 AI 请求或完成
        deadline = time.time() + 120
        final_result = None

        while time.time() < deadline and proc.poll() is None:
            if os.path.exists(prompt_file):
                time.sleep(0.3)
                try:
                    with open(prompt_file) as f:
                        prompt_data = json.load(f)
                    os.remove(prompt_file)

                    # 调用 AI
                    snapshot = prompt_data.get('snapshot', '')
                    step = prompt_data.get('step', 0)
                    history = prompt_data.get('history', '')

                    messages = [
                        {'role': 'system', 'content': (
                            '你是一个浏览器自动化助手。根据页面快照决定下一步操作。'
                            '返回 JSON: {"action":"navigate|search|click|type|extract|scroll|back|done", ...}'
                            'navigate: {"action":"navigate","url":"..."}'
                            'search: {"action":"search","query":"..."}'
                            'click: {"action":"click","index":数字} (元素编号)'
                            'type: {"action":"type","index":数字,"text":"..."}'
                            'extract: {"action":"extract"}'
                            'scroll: {"action":"scroll"}'
                            'back: {"action":"back"}'
                            'done: {"action":"done","summary":"总结"}'
                            '当搜索结果显示后，如果任务要求总结，请提取关键信息后用 done 返回总结。'
                            '如果已获取足够信息完成任务，用 done 返回。'
                            '只返回 JSON，不要其他文字。'
                        )},
                        {'role': 'user', 'content': (
                            f'任务: {task_desc}\n'
                            f'当前步骤: {step + 1}/{max_steps}\n'
                            f'历史操作: {history}\n\n'
                            f'页面快照:\n{snapshot}\n\n'
                            f'请决定下一步操作 (只返回JSON):'
                        )}
                    ]

                    ai_response = call_ai(messages)
                    # 提取 JSON
                    json_match = re.search(r'\{[^{}]*"action"[^{}]*\}', ai_response, re.DOTALL)
                    if json_match:
                        ai_json = json_match.group(0)
                        try:
                            json.loads(ai_json)
                        except:
                            ai_json = '{"action":"done","summary":"无法解析AI响应"}'
                    else:
                        ai_json = '{"action":"done","summary":"AI响应格式错误"}'

                    logger.info(f'[任务 {task_id}] AI 步骤 {step+1}: {ai_json[:200]}')

                    with open(resp_file, 'w') as f:
                        json.dump({'action': ai_json}, f)
                except Exception as e:
                    logger.error(f'[任务 {task_id}] AI 调用失败: {e}')
                    with open(resp_file, 'w') as f:
                        json.dump({'action': '{"action":"done","summary":"AI调用失败"}'}, f)
            else:
                time.sleep(0.5)

        # 等待子进程结束
        try:
            proc.wait(timeout=10)
        except:
            proc.kill()

        # 读取结果
        if os.path.exists(output_file):
            with open(output_file) as f:
                result = json.load(f)
            os.remove(output_file)
            final_result = result.get('result', result.get('error', ''))
        else:
            final_result = '任务超时或子进程异常退出'

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
    import urllib.request
    try:
        data = json.dumps({'task_id': task_id, 'status': status, 'result': result[:4000] if result else ''}).encode()
        req = urllib.request.Request(CALLBACK_URL, data=data, headers={'Content-Type': 'application/json'}, method='POST')
        urllib.request.urlopen(req, timeout=10)
    except:
        pass


class AgentHandler(BaseHTTPRequestHandler):
    def log_message(self, f, *a):
        logger.info(f % a)

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path)
        if p.path == '/health':
            self._send_json({'status': 'ok', 'tasks': len(tasks), 'model': AI_MODEL})
        elif p.path.startswith('/status/'):
            tid = p.path.split('/')[-1]
            with tasks_lock:
                t = tasks.get(tid)
            if t:
                self._send_json({'task_id': tid, 'status': t['status'], 'result': t.get('result', ''), 'error': t.get('error', '')})
            else:
                self._send_json({'error': 'not found'}, 404)
        elif p.path == '/tasks':
            with tasks_lock:
                self._send_json({'tasks': {tid: {'status': t['status'], 'task': t['task'][:100]} for tid, t in tasks.items()}})
        else:
            self._send_json({'error': 'not found'}, 404)

    def do_POST(self):
        p = urlparse(self.path)
        if p.path == '/run':
            length = int(self.headers.get('Content-Length', 0))
            try:
                data = json.loads(self.rfile.read(length))
            except:
                self._send_json({'error': 'invalid JSON'}, 400)
                return
            task_desc = data.get('task', '')
            if not task_desc:
                self._send_json({'error': 'task required'}, 400)
                return
            tid = str(uuid.uuid4())[:8]
            with tasks_lock:
                tasks[tid] = {'task': task_desc, 'status': 'pending', 'created_at': time.time()}
            threading.Thread(target=run_browser_task, args=(tid, task_desc, data.get('max_steps', MAX_STEPS)), daemon=True).start()
            self._send_json({'task_id': tid, 'status': 'pending'})
        else:
            self._send_json({'error': 'not found'}, 404)


def main():
    import signal
    signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)

    socketserver.TCPServer.allow_reuse_address = True
    HTTPServer.allow_reuse_address = True

    for i in range(8):
        try:
            server = HTTPServer(('0.0.0.0', PORT), AgentHandler)
            server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            break
        except OSError:
            if i < 7:
                time.sleep(3)
            else:
                raise

    logger.info(f'Browser Agent 已启动 :{PORT} 模型={AI_MODEL} (GitHub免费)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()