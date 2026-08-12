// Легкий статичний http-сервер для тестів, без зовнішніх залежностей.
// ПОТРІБЕН, бо гра тепер вантажить іконки з assets/*.png через
// this.load.image() (замість старих base64-в-game.js), а Phaser вантажить
// зображення через XHR — браузери блокують XHR-запити до file://. Тому
// index.html більше не можна відкривати напряму як file:// (ані в грі, ані
// в тестах) — і тести, і сама гра відтепер потребують http-сервера.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

// Стартує сервер на випадковому вільному порту, роздає файли з rootDir.
// Повертає { server, url } — url вже з кінцевим "/", просто дописуй
// "index.html" тощо.
function startServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(rootDir, urlPath);
      // не виходимо за межі rootDir
      if (!filePath.startsWith(path.resolve(rootDir))) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

module.exports = { startServer };
