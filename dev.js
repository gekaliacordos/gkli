import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import auth from './api/auth.js';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/assets/brand/gkli-assinatura.jpg', ['assets/brand/gkli-assinatura.jpg', 'image/jpeg']],
  ['/assets/brand/montserrat.woff2', ['assets/brand/montserrat.woff2', 'font/woff2']],
  ['/assets/brand/nunito.woff2', ['assets/brand/nunito.woff2', 'font/woff2']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/core.js', ['core.js', 'text/javascript']],
  ['/operation.js', ['operation.js', 'text/javascript']],
]);

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api/auth') return auth(req, res);
  const asset = assets.get(path);
  if (!asset || req.method !== 'GET') {
    res.writeHead(404).end();
    return;
  }
  const [file, type] = asset;
  res.writeHead(200, { 'Content-Type': type.startsWith('text/') ? `${type}; charset=utf-8` : type, 'Referrer-Policy': 'no-referrer' });
  res.end(await readFile(new URL(`./public/${file}`, import.meta.url)));
}).listen(3000, 'localhost', () => console.log('http://localhost:3000'));
