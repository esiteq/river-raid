// Мінімальний статичний http-сервер для локального запуску гри, без
// зовнішніх залежностей (не потрібен express чи щось подібне).
// ПОТРІБЕН, бо гра вантажить іконки з assets/*.png через this.load.image()
// (замість старих base64-в-game.js) — Phaser робить це через XHR, а браузери
// блокують XHR-запити до file://. Тому index.html більше НЕ можна просто
// відкрити подвійним кліком — треба локальний сервер.
//
// Запуск: npm start   (або: node serve.js [порт])
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`River Raid: http://localhost:${PORT}/  (Ctrl+C — зупинити)`);
});
