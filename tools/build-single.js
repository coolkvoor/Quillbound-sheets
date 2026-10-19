// Builds one self-contained HTML page (the engine worker starts from a blob URL).
// dist-single/index.html: the artifact page (no skeleton); pdf-lib comes from cdnjs, so the page holds only this app's code.
// dist-single/MPMB-Sheet-App.html: the complete file to download, with pdf-lib bundled so it needs no network for the worker.
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const VERSION = process.argv[2] || '0.2';
const PDFLIB_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
const own = [read('src/loader.js'), read('src/engine.js'), read('src/selftest.js'), read('src/content.js'), read('src/spells.js'), read('src/writer.js'), read('src/classes.js'), read('src/abilities.js'), read('src/worker.js')];
const workerCdn = ['importScripts(' + JSON.stringify(PDFLIB_CDN) + ');'].concat(own).join('\n;\n');
// the publisher rejects raw U+FFFD characters; they only occur inside pdf-lib's string literals
const workerBundled = [read('node_modules/pdf-lib/dist/pdf-lib.min.js').replace(/\uFFFD/g, '\\ufffd')].concat(own).join('\n;\n');
// the version and build time show under Sheet > This sheet, to tell which build a device is running
// build time in Amsterdam time (CET/CEST), e.g. "2026-10-18 23:45 CEST"
const BUILT = (() => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const zone = p.timeZoneName === 'GMT+2' ? 'CEST' : p.timeZoneName === 'GMT+1' ? 'CET' : p.timeZoneName;
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ' ' + zone;
})();
const app = read('src/features.js') + '\n;\n' + read('src/app.js').replace("const APP_BUILD = 'development build';", 'const APP_BUILD = ' + JSON.stringify('Version ' + VERSION + ', built ' + BUILT) + ';');
if (app.indexOf('built ' + BUILT) === -1) throw new Error('APP_BUILD marker not found in src/app.js');
function page(worker) {
  for (const bad of ['</script', '<!--']) if (worker.includes(bad) || app.includes(bad)) throw new Error('bundle contains ' + bad);
  let p = read('src/index.html').replace('<script src="features.js"></script>', '').replace('<script src="app.js"></script>', '');
  p += '\n<script type="text/plain" id="mpmb-worker-src">\n' + worker + '\n</script>\n'
    + '<script>window.MPMB_WORKER_URL = URL.createObjectURL(new Blob([document.getElementById("mpmb-worker-src").textContent], { type: "text/javascript" }));</script>\n'
    + '<script>\n' + app + '\n</script>\n';
  // the start screen says which build this is (the same as Sheet > This sheet > App)
  return p.replace(/Version 0\.1 test build/g, 'Version ' + VERSION + ' test build, built ' + BUILT);
}
const out = path.join(R, 'dist-single');
fs.mkdirSync(out, { recursive: true });
const artifact = page(workerCdn);
fs.writeFileSync(path.join(out, 'index.html'), artifact);
const full = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}</style></head><body>\n' + page(workerBundled) + '\n</body></html>\n';
fs.writeFileSync(path.join(out, 'MPMB-Sheet-App.html'), full);
console.log('dist-single/index.html', (artifact.length / 1024).toFixed(0) + ' KB (pdf-lib from cdnjs);', 'MPMB-Sheet-App.html', (full.length / 1024).toFixed(0) + ' KB (pdf-lib bundled)');
// dist-site/: the app for its own web address (Cloudflare Pages): the complete page, plus the headers that make it
// cross-origin isolated, so MPMB's dialogs wait for the user (engine worker + Atomics.wait)
const site = path.join(R, 'dist-site');
fs.mkdirSync(site, { recursive: true });
fs.writeFileSync(path.join(site, 'index.html'), full);
fs.writeFileSync(path.join(site, '_headers'), '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: credentialless\n  Cache-Control: no-cache\n');
console.log('dist-site/ for its own web address (index.html + _headers)');
