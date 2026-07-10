const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'Dados salvos');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// Garante que o diretório "Dados salvos" exista
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// MIME types dictionary
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // 1. Handle API Endpoints
    if (req.url === '/api/data') {
        if (req.method === 'GET') {
            fs.readFile(DATA_FILE, 'utf8', (err, data) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({}));
                    } else {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Erro ao ler arquivo de dados local.' }));
                    }
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
            });
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    fs.writeFile(DATA_FILE, JSON.stringify(parsed, null, 4), 'utf8', (err) => {
                        if (err) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Erro ao gravar arquivo de dados local.' }));
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    });
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'JSON inválido.' }));
                }
            });
            return;
        }

        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Método não permitido.' }));
        return;
    }

    // 2. Handle Static Files
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = filePath.split('?')[0].split('#')[0];
    
    const fullPath = path.join(__dirname, '..', filePath);
    
    // Safety check: ensure file is inside project root
    const projectRoot = path.join(__dirname, '..');
    if (!fullPath.startsWith(projectRoot)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Acesso proibido');
        return;
    }

    fs.stat(fullPath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Arquivo não encontrado');
            return;
        }

        const ext = path.extname(fullPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(fullPath);
        stream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` Marketing Check - Servidor Local Ativo`);
    console.log(` Acesse o dashboard em: http://localhost:${PORT}`);
    console.log(` Salvando dados em: ${DATA_FILE}`);
    console.log(` Para encerrar o servidor, feche esta janela ou use Ctrl+C`);
    console.log(`==================================================`);
});
