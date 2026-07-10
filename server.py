import http.server
import socketserver
import os
import json

PORT = 3000
DATA_DIR = os.path.join(os.path.dirname(__file__), 'Dados salvos')
DATA_FILE = os.path.join(DATA_DIR, 'data.json')

# Garante que a pasta "Dados salvos" exista
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR, exist_ok=True)

class PCPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_GET(self):
        if self.path == '/api/data':
            self.send_response(200)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.end_headers()
            
            if os.path.exists(DATA_FILE):
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    self.wfile.write(f.read().encode('utf-8'))
            else:
                self.wfile.write(b'{}')
            return
            
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/data':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                
                with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=4, ensure_ascii=False)
                    
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"success": true}')
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), PCPRequestHandler) as httpd:
    print("==================================================")
    print(" Marketing Check - Servidor Local Python Ativo")
    print(f" Acesse o dashboard em: http://localhost:{PORT}")
    print(f" Salvando dados em: {DATA_FILE}")
    print(" Para encerrar o servidor, feche esta janela ou use Ctrl+C")
    print("==================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
