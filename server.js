const http = require('http');
const fs = require('fs');
const path = require('path');
const { PeerServer } = require('peer');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const BLOCKED = new Set(['server.js', 'package.json', 'package-lock.json', '.gitignore', 'README.md']);

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url.endsWith('/')) url += 'index.html';
  const filePath = path.normalize(path.join(__dirname, url));
  if (!filePath.startsWith(__dirname) || BLOCKED.has(path.basename(filePath))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

PeerServer({ server, path: '/peerjs' });

server.listen(PORT, () => {
  console.log('CalmChat: http://localhost:' + PORT);
});
