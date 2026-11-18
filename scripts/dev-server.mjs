/** 개발용 간단 서버: www/ 를 그대로 보여준다. (npm run dev) 주소 변환 없음, 영상 탐색(Range) 지원 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');
let port = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }).end(); return; }
    f = path.join(f, 'index.html');
  }
  if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found: ' + p); return; }
  const size = fs.statSync(f).size;
  const h = { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    let s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : size - 1;
    if (!m[1] && m[2]) { s = size - +m[2]; e = size - 1; }
    e = Math.min(e, size - 1);
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 });
    fs.createReadStream(f, { start: s, end: e }).pipe(res);
  } else {
    res.writeHead(200, { ...h, 'Content-Length': size });
    fs.createReadStream(f).pipe(res);
  }
});
server.on('error', (e) => { if (e.code === 'EADDRINUSE') { port++; server.listen(port); } else throw e; });
server.on('listening', () => console.log(`\n  실행 중:  http://localhost:${port}\n  (끄려면 Ctrl+C)\n`));
server.listen(port);
