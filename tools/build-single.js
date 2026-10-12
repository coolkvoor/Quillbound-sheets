// Builds one self-contained HTML file (everything inlined; the engine worker starts from a blob URL).
// Writes dist-single/index.html (artifact page content, no skeleton) and dist-single/MPMB-Sheet-App.html (complete file to download).
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const VERSION = process.argv[2] || '0.1';
let worker = [read('node_modules/pdf-lib/dist/pdf-lib.min.js'), read('src/loader.js'), read('src/engine.js'), read('src/selftest.js'), read('src/content.js'), read('src/worker.js')].join('\n;\n');
worker = worker.replace(/�/g, '\\ufffd');
for (const bad of ['</script', '<!--']) if (worker.includes(bad) || read('src/app.js').includes(bad)) throw new Error('bundle contains ' + bad);
let page = read('src/index.html').replace('<script src="app.js"></script>', '');
page += '\n<script type="text/plain" id="mpmb-worker-src">\n' + worker + '\n</script>\n'
  + '<script>window.MPMB_WORKER_URL = URL.createObjectURL(new Blob([document.getElementById("mpmb-worker-src").textContent], { type: "text/javascript" }));</script>\n'
  + '<script>\n' + read('src/app.js') + '\n</script>\n';
page = page.replace(/Version 0\.1 test build/g, 'Version ' + VERSION + ' test build');
const out = path.join(R, 'dist-single');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), page);
const full = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}</style></head><body>\n' + page + '\n</body></html>\n';
fs.writeFileSync(path.join(out, 'MPMB-Sheet-App.html'), full);
console.log('dist-single/index.html', (page.length / 1024).toFixed(0) + ' KB;', 'MPMB-Sheet-App.html', (full.length / 1024).toFixed(0) + ' KB');
