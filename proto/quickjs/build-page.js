// Builds the phone test page: proto/quickjs/dist/speed-test.html, one file (an artifact page: no doctype or head).
// The page reads the PDF with the app's loader (pdf-lib from cdnjs), then runs steps.js in three fresh workers:
// V8 (the app's engine as it runs now), QuickJS, and QuickJS with pauses (asyncify). The QuickJS builds carry their
// WebAssembly inside the script (the "singlefile" variants), because an artifact page can't fetch other files.
//   node proto/quickjs/build-page.js
const fs = require('fs'), path = require('path');
const esbuild = require('esbuild');
const D = __dirname, R = path.join(D, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const src = (n) => read(path.join(R, 'src', n));
const STEPS = require('./steps');
const PDFLIB_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';

const bundle = esbuild.buildSync({ entryPoints: [path.join(D, 'qjs-entry.js')], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, write: false, logLevel: 'error' }).outputFiles[0].text;
const SRC = { engine: src('engine.js'), content: src('content.js'), selftest: src('selftest.js') };
// inside a <script type="text/plain"> nothing may close the tag; in JSON strings "<\/script" means the same text
const safeJSON = (o) => JSON.stringify(o).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--').replace(/�/g, '\\ufffd');
const v8Worker = [SRC.engine, SRC.content, SRC.selftest, `
self.onmessage = function (e) {
  var m = e.data || {};
  self.__modelJSON = m.model; self.__addonText = m.addon || '';
  try { postMessage({ ok: true, result: JSON.parse((0, eval)(m.steps)) }); }
  catch (err) { postMessage({ ok: false, error: String(err && err.stack || err) }); }
};`].join('\n;\n');
const qjsWorker = bundle + '\n;\nvar SRC = ' + safeJSON(SRC) + ';\n' + read(path.join(D, 'qjs-worker.js'));
for (const [name, text] of [['v8 worker', v8Worker], ['QuickJS worker', qjsWorker], ['loader', src('loader.js')]]) {
  if (/<\/script|<!--/i.test(text)) throw new Error(name + ' contains </script or <!--');
  if (/�/.test(text)) throw new Error(name + ' contains U+FFFD (the publisher rejects it)');
}
let page = read(path.join(D, 'page.html'));
if (page.indexOf("/*STEPS*/''") === -1) throw new Error('STEPS marker missing in page.html');
page = page.replace("/*STEPS*/''", () => safeJSON(STEPS));
const scripts = '<script src="' + PDFLIB_CDN + '"></script>\n'
  + '<script>\n' + src('loader.js') + '\n</script>\n'
  + '<script type="text/plain" id="v8-src">\n' + v8Worker + '\n</script>\n'
  + '<script type="text/plain" id="qjs-src">\n' + qjsWorker + '\n</script>\n';
const at = page.lastIndexOf('<script>');
page = page.slice(0, at) + scripts + page.slice(at);
fs.mkdirSync(path.join(D, 'dist'), { recursive: true });
const out = path.join(D, 'dist', 'speed-test.html');
fs.writeFileSync(out, page);
console.log(path.relative(R, out), (page.length / 1048576).toFixed(2) + ' MB (QuickJS bundle ' + (bundle.length / 1048576).toFixed(2) + ' MB)');
