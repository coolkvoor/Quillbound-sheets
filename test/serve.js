// Serves dist/ like the artifact host does: index.html wrapped in a minimal skeleton.
// node test/serve.js [folder]   (or DIST=folder); `npm start` builds dist-single first and serves it.
const http = require('http'), fs = require('fs'), path = require('path');
const DIST_ARG = require.main === module ? process.argv[2] : null;
const DIST = DIST_ARG ? path.resolve(DIST_ARG) : process.env.DIST ? path.resolve(process.env.DIST) : path.join(__dirname, '..', 'dist');
const SKELETON = (body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
function start(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(DIST, p);
      if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
      let body = fs.readFileSync(f);
      if (p === '/index.html') body = SKELETON(body.toString());
      // never cached, so a reload always gets the build on disk
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    });
    srv.listen(port || 0, () => resolve(srv));
  });
}
module.exports = { start };
if (require.main === module) start(8123).then(() => console.log('Serving ' + DIST + '\nOpen http://localhost:8123 in Chrome. Press Ctrl+C to stop.'));
