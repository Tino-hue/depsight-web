# 本地静态服务器（避免 file:// 跨域问题）
# 用法：python serve.py [port]
# 默认端口 8080

import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 允许跨域（WASM、fetch 需要）
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.wasm'):
            return 'application/wasm'
        if path.endswith('.mjs'):
            return 'text/javascript'
        return super().guess_type(path)

    def log_message(self, format, *args):
        # 简化日志
        pass

os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"depsight Web → http://localhost:{PORT}")
    print(f"按 Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
