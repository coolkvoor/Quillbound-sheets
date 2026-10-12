// Builds one self-contained HTML page (the engine worker starts from a blob URL).
// dist-single/index.html: the artifact page (no skeleton); pdf-lib comes from cdnjs, so the page holds only this app's code.
// dist-single/MPMB-Sheet-App.html: the complete file to download, with pdf-lib bundled so it needs no network for the worker.
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const VERSION = process.argv[2] || '0.1';
const PDFLIB_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
const own = [read('src/loader.js'), read('src/engine.js'), read('src/selftest.js'), read('src/content.js'), read('src/spells.js'), read('src/writer.js'), read('src/worker.js')];
const workerCdn = ['importScripts(' + JSON.stringify(PDFLIB_CDN) + ');'].concat(own).join('\n;\n');
// the publisher rejects raw U+FFFD characters; they only occur inside pdf-lib's string literals
const workerBundled = [read('node_modules/pdf-lib/dist/pdf-lib.min.js').replace(/\uFFFD/g, '\\ufffd')].concat(own).join('\n;\n');
const app = read('src/app.js');
function page(worker) {
  for (const bad of ['</script', '<!--']) if (worker.includes(bad) || app.includes(bad)) throw new Error('bundle contains ' + bad);
  let p = read('src/index.html').replace('<script src="app.js"></script>', '');
  p += '\n<script type="text/plain" id="mpmb-worker-src">\n' + worker + '\n</script>\n'
    + '<script>window.MPMB_WORKER_URL = URL.createObjectURL(new Blob([document.getElementById("mpmb-worker-src").textContent], { type: "text/javascript" }));</script>\n'
    + '<script>\n' + app + '\n</script>\n';
  return p.replace(/Version 0\.1 test build/g, 'Version ' + VERSION + ' test build');
}
const out = path.join(R, 'dist-single');
fs.mkdirSync(out, { recursive: true });
const artifact = page(workerCdn);
fs.writeFileSync(path.join(out, 'index.html'), artifact);
const full = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}</style></head><body>\n' + page(workerBundled) + '\n</body></html>\n';
fs.writeFileSync(path.join(out, 'MPMB-Sheet-App.html'), full);
console.log('dist-single/index.html', (artifact.length / 1024).toFixed(0) + ' KB (pdf-lib from cdnjs);', 'MPMB-Sheet-App.html', (full.length / 1024).toFixed(0) + ' KB (pdf-lib bundled)');
