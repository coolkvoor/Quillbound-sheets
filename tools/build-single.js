// Builds one self-contained HTML page (the engine worker starts from a blob URL).
// dist-single/index.html: the artifact page (no skeleton); pdf-lib comes from cdnjs, so the page holds only this app's code.
// dist-single/Quillbound-Sheets.html: the complete file to download, with pdf-lib bundled so it needs no network for the worker.
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
// the version users see comes from package.json (1.0.0 shows as 1.0). A version given on the command line is ignored:
// Cloudflare's build command still passes 0.2.
const APP_NAME = 'Quillbound Sheets';   // what users see; storage names keep mpmb (saved characters)
const VERSION = JSON.parse(read('package.json')).version.split('.').slice(0, 2).join('.');
const PDFLIB_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
const own = [read('src/loader.js'), read('src/engine.js'), read('src/content.js'), read('src/spells.js'), read('src/appearance.js'), read('src/writer.js'), read('src/classes.js'), read('src/abilities.js'), read('src/worker.js')];
// the engine and content code once more, for the two frames MPMB's Direct Import runs in (ui-import.js)
const realm = [read('src/engine.js'), read('src/content.js')].join('\n;\n');
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
// the page's own scripts, in the order index.html loads them (features.js, ui-core.js, ui-*.js, app.js last)
const PAGE_SCRIPTS = Array.from(read('src/index.html').matchAll(/<script src="([\w.-]+\.js)"><\/script>/g), (m) => m[1]);
if (PAGE_SCRIPTS[PAGE_SCRIPTS.length - 1] !== 'app.js') throw new Error('src/index.html must load app.js last');
const app = PAGE_SCRIPTS.map((f) => (f !== 'app.js' ? read('src/' + f)
  : read('src/app.js').replace("const APP_BUILD = 'development build';", 'const APP_BUILD = ' + JSON.stringify(APP_NAME + ' ' + VERSION) + ';')
    .replace("const APP_BUILD_ID = '';", 'const APP_BUILD_ID = ' + JSON.stringify(BUILT) + ';'))).join('\n;\n');
if (app.indexOf(JSON.stringify(BUILT)) === -1 || app.indexOf(JSON.stringify(APP_NAME + ' ' + VERSION)) === -1) throw new Error('APP_BUILD / APP_BUILD_ID marker not found in src/app.js');
// pdf.js for the downloadable file (pictures without a connection); the other builds load it from cdnjs
const pdfjsLib = read('node_modules/pdfjs-dist/build/pdf.min.js'), pdfjsWorker = read('node_modules/pdfjs-dist/build/pdf.worker.min.js');
// the licence texts of the parts every build uses (Settings → Credits and licences shows them; renderCredits in app.js)
const LICENCES = [['pdf-lib (MIT License)', 'node_modules/pdf-lib/LICENSE.md'], ['PDF.js (Apache License 2.0)', 'node_modules/pdfjs-dist/LICENSE'],
  ['Alegreya SC (SIL Open Font License 1.1)', 'node_modules/@fontsource/alegreya-sc/LICENSE'], ['Alegreya Sans (SIL Open Font License 1.1)', 'node_modules/@fontsource/alegreya-sans/LICENSE']];
const licences = '<script type="text/plain" id="mpmb-licences">' + JSON.stringify(LICENCES.map(([name, f]) => ({ name, text: read(f).replace(/\r\n?/g, '\n').trim() }))).replace(/</g, '\\u003c') + '</script>\n';
function page(worker, withPdfjs) {
  for (const bad of ['</script', '<!--']) if ([worker, app, realm].concat(withPdfjs ? [pdfjsLib, pdfjsWorker] : []).some((s) => s.includes(bad))) throw new Error('bundle contains ' + bad);
  let p = read('src/index.html');
  for (const f of PAGE_SCRIPTS) p = p.replace('<script src="' + f + '"></script>', '');
  p += '\n' + licences + '<script type="text/plain" id="mpmb-worker-src">\n' + worker + '\n</script>\n'
    + '<script type="text/plain" id="mpmb-realm-src">\n' + realm + '\n</script>\n'
    + (withPdfjs ? '<script type="text/plain" id="mpmb-pdfjs-src">\n' + pdfjsLib + '\n</script>\n<script type="text/plain" id="mpmb-pdfjs-worker-src">\n' + pdfjsWorker + '\n</script>\n' : '')
    + '<script>window.MPMB_WORKER_URL = URL.createObjectURL(new Blob([document.getElementById("mpmb-worker-src").textContent], { type: "text/javascript" }));</script>\n'
    + '<script>\n' + app + '\n</script>\n';
  // the start screen says which build this is (the same as Sheet > This sheet > App)
  return p.replace(/Version 0\.1 test build/g, 'Version ' + VERSION);
}
const out = path.join(R, 'dist-single');
fs.mkdirSync(out, { recursive: true });
const artifact = page(workerCdn);
fs.writeFileSync(path.join(out, 'index.html'), artifact);
// the complete page; the downloadable file also carries pdf.js, so it works fully without a connection (the site's
// service worker keeps pdf.js from cdnjs instead, which keeps the page the site sends at every start smaller)
const fullPage = (withPdfjs) => '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  + '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}</style></head><body>\n' + page(workerBundled, withPdfjs) + '\n</body></html>\n';
const file = fullPage(true), full = fullPage(false);
fs.writeFileSync(path.join(out, 'Quillbound-Sheets.html'), file);
console.log('dist-single/index.html', (artifact.length / 1024).toFixed(0) + ' KB (pdf-lib from cdnjs);', 'Quillbound-Sheets.html', (file.length / 1024).toFixed(0) + ' KB (pdf-lib and pdf.js bundled)');
// dist-site/: the app for its own web address (Cloudflare Pages): the complete page, plus the headers that make it
// cross-origin isolated, so MPMB's dialogs wait for the user (engine worker + Atomics.wait)
const site = path.join(R, 'dist-site');
fs.mkdirSync(site, { recursive: true });
// It is also the installable app: a manifest, icons and a service worker (src/pwa) that keeps the page for offline use.
// The manifest is fetched with the login cookie (use-credentials), or Cloudflare Access answers it with its login page.
const PWA = ['manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const pwaHead = '<link rel="manifest" href="manifest.webmanifest" crossorigin="use-credentials">'
  + '<meta name="theme-color" content="#141114"><link rel="icon" href="icon.svg" type="image/svg+xml">'
  + '<link rel="apple-touch-icon" href="apple-touch-icon.png"><script>window.MPMB_SW = "sw.js";</script>';
// The site contacts no other address: pdf.js and the two fonts (SIL Open Font License, from the @fontsource packages)
// are served from the site itself, and the security headers below only allow the site's own address.
fs.mkdirSync(path.join(site, 'pdfjs'), { recursive: true });
fs.mkdirSync(path.join(site, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(R, 'node_modules/pdfjs-dist/build/pdf.min.js'), path.join(site, 'pdfjs/pdf.min.js'));
fs.copyFileSync(path.join(R, 'node_modules/pdfjs-dist/build/pdf.worker.min.js'), path.join(site, 'pdfjs/pdf.worker.min.js'));
const FONTS = [['alegreya-sc', ['500', '700']], ['alegreya-sans', ['400', '400-italic', '500', '700']]];
const fontFiles = [];
let fontCss = '';
for (const [pkg, styles] of FONTS) {
  for (const s of styles) {
    // the latin and latin-ext faces of fontsource's CSS (the sheet's text), pointing at the copied woff2 files
    for (const face of read('node_modules/@fontsource/' + pkg + '/' + s + '.css').split('@font-face').slice(1)) {
      const m = face.match(/url\(\.\/files\/([\w-]+-latin(?:-ext)?-\d+-(?:normal|italic)\.woff2)\)/);
      if (!m) continue;
      fs.copyFileSync(path.join(R, 'node_modules/@fontsource', pkg, 'files', m[1]), path.join(site, 'fonts', m[1]));
      fontFiles.push('fonts/' + m[1]);
      fontCss += '@font-face' + face.replace(/\/\*[^*]*\*\//g, '').replace(/src:[^;]+;/, "src: url(fonts/" + m[1] + ") format('woff2');").trim() + '\n';
    }
  }
}
if (fontFiles.length < 8) throw new Error('fonts not found in node_modules/@fontsource (npm install)');
const GOOGLE = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2[^"]*">/;
if (!GOOGLE.test(full)) throw new Error('Google fonts links not found in src/index.html');
const sitePage = full.replace(GOOGLE, '<style>' + fontCss + '</style>')
  .replace('</head>', pwaHead + '<script>window.MPMB_PDFJS = "pdfjs/";</script></head>');
if (sitePage.indexOf('MPMB_PDFJS') === -1) throw new Error('no </head> in the full page');
if (/googleapis|gstatic|cdnjs/.test(sitePage.replace(/<script type="text\/plain"[\s\S]*?<\/script>/g, '').replace(/<script>\n[\s\S]*?\n<\/script>/g, ''))) throw new Error('the site page still links another site');
fs.writeFileSync(path.join(site, 'index.html'), sitePage);
// the build the site serves now: an app left open checks it and offers to reload when it's newer (wireUpdates in app.js)
fs.writeFileSync(path.join(site, 'version.json'), JSON.stringify({ version: VERSION, build: BUILT }) + '\n');
for (const f of PWA) fs.copyFileSync(path.join(R, 'src', 'pwa', f), path.join(site, f));
// the service worker keeps these for offline use from the start (pictures and fonts without a connection)
const sw = read('src/pwa/sw.js');
const OWN_MARK = "'apple-touch-icon.png'];";
if (sw.indexOf(OWN_MARK) === -1) throw new Error('OWN list not found in src/pwa/sw.js');
fs.writeFileSync(path.join(site, 'sw.js'), sw.replace(OWN_MARK, "'apple-touch-icon.png', " + ['pdfjs/pdf.min.js', 'pdfjs/pdf.worker.min.js'].concat(fontFiles).map((f) => JSON.stringify(f)).join(', ') + '];'));
// Content-Security-Policy: only this site's own address. MPMB's scripts need eval ('unsafe-eval'), the page's code is
// inline, the engine worker starts from a blob: URL (data: as a fallback), pictures are blob:/data: images.
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:", "worker-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:", "font-src 'self'", "connect-src 'self' blob: data:",
  "frame-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');
const HEADERS = ['Cross-Origin-Opener-Policy: same-origin', 'Cross-Origin-Embedder-Policy: credentialless', 'Cache-Control: no-cache',
  'Content-Security-Policy: ' + CSP, 'X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'X-Frame-Options: DENY',
  'Cross-Origin-Resource-Policy: same-origin', 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()'];
fs.writeFileSync(path.join(site, '_headers'), '/*\n' + HEADERS.map((h) => '  ' + h + '\n').join(''));
console.log('dist-site/ for its own web address (index.html + _headers + the installable app files)');
