"""
ChatRoom AI 问答服务 - 纯对话模式
端口: 3002
"""
import os, json, time, logging, socket, socketserver
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# 读取 .env 文件
env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
if os.path.exists(env_file):
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

logging.basicConfig(level=logging.INFO, format='[ai-chat] %(message)s')
logger = logging.getLogger('ai-chat')

PORT = int(os.getenv('BROWSER_AGENT_PORT', '3002'))
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN', '')
AI_MODEL = os.getenv('AI_MODEL', 'gpt-4o-mini')
API_URL = 'https://models.inference.ai.azure.com/chat/completions'

SYSTEM_PROMPT = (
    '你是"屿岸"，一个友好、热心的AI助手。'
    '请用自然流畅的中文回复用户。'
    '回答风格：简洁直接，像朋友聊天一样自然，不要啰嗦。'
    '如果用户问的问题你不知道，诚实地说不知道，不要编造。'
    '尽量保持回复在300字以内。'
)


def call_ai(messages: list[dict]) -> str:
    """调用 GitHub Models API"""
    import urllib.request
    data = json.dumps({
        'model': AI_MODEL,
        'messages': messages,
        'temperature': 0.7,
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


class ChatHandler(BaseHTTPRequestHandler):
    def log_message(self, f, *a):
        pass

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
            self._send_json({'status': 'ok', 'model': AI_MODEL})
        else:
            self._send_json({'error': 'not found'}, 404)

    def do_POST(self):
        p = urlparse(self.path)
        if p.path == '/chat':
            length = int(self.headers.get('Content-Length', 0))
            try:
                data = json.loads(self.rfile.read(length))
            except:
                self._send_json({'error': 'invalid JSON'}, 400)
                return

            message = data.get('message', '').strip()
            if not message:
                self._send_json({'error': 'message required'}, 400)
                return

            history = data.get('history', [])
            # 构建消息列表
            messages = [{'role': 'system', 'content': SYSTEM_PROMPT}]
            for h in history[-10:]:  # 最多保留10轮历史
                if h.get('role') in ('user', 'assistant'):
                    messages.append({'role': h['role'], 'content': h['content']})
            messages.append({'role': 'user', 'content': message})

            logger.info(f'收到消息: {message[:50]}...')
            try:
                reply = call_ai(messages)
                logger.info(f'回复: {reply[:50]}...')
                self._send_json({'reply': reply})
            except Exception as e:
                logger.error(f'AI调用失败: {e}')
                self._send_json({'error': str(e)}, 500)
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
            server = HTTPServer(('0.0.0.0', PORT), ChatHandler)
            server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            break
        except OSError:
            if i < 7:
                time.sleep(3)
            else:
                raise

    logger.info(f'AI Chat 已启动 :{PORT} 模型={AI_MODEL} (GitHub免费)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()