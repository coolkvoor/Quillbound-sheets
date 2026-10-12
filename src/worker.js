/* The engine worker: loads the PDF, runs MPMB's code, and answers the app's requests.
 * Each worker is one sheet (one JavaScript realm), because MPMB changes built-in prototypes. */
'use strict';
// In the single-file build everything is already bundled in front of this file
if (!self.MPMBEngine) {
  try { importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'); } catch (e) { importScripts('vendor/pdf-lib.min.js'); }
  importScripts('loader.js', 'engine.js', 'selftest.js');
}
// Everything below stays out of the global scope, which belongs to MPMB's code
(function () {

let engine = null;
let watched = new Set();
const evalGlobal = (code) => (0, eval)(code);
const now = () => performance.now();

function progress(text) { postMessage({ type: 'progress', text }); }
function changesFor(names) {
  const out = [];
  for (let i = 0; i < names.length; i++) if (watched.has(names[i])) out.push(engine.snapshot(names[i]));
  return out;
}
function logSummary() {
  const l = engine.log;
  return { alerts: l.alerts.slice(-40), dialogs: l.dialogs.slice(-40), menus: l.menus.slice(-20), errors: l.errors.slice(-40), unsupported: Object.assign({}, l.unsupported), urls: l.urls.slice(-10) };
}

const ops = {
  async open({ bytes, fileName }) {
    try { evalGlobal('1+1'); } catch (e) { throw new Error('EVAL_BLOCKED'); }
    const t0 = now();
    const model = await MPMBLoader.load(new Uint8Array(bytes), self.PDFLib, progress);
    const loadMs = Math.round(now() - t0);
    const names = model.docScripts.map((s) => s.name);
    if (names.indexOf('Startup') === -1 || !model.info.SheetVersion) throw new Error('NOT_MPMB');
    progress('Starting MPMB’s scripts');
    engine = MPMBEngine.createEngine(model, { global: self, evalGlobal }, { fileName });
    const startMs = engine.start();
    engine.drainChanges();
    return {
      info: { title: model.info.Title || '', version: model.info.SheetVersion || '', type: model.info.SheetType || '', author: model.info.Author || '' },
      stats: { bytes: model.stats.bytes, loadMs, startMs, fields: model.fieldOrder.length, scripts: model.docScripts.length, pages: model.pageCount, templates: model.templates.length },
      log: logSummary(),
    };
  },
  watch({ names }) {
    for (let i = 0; i < names.length; i++) watched.add(names[i]);
    return names.map((n) => engine.snapshot(n));
  },
  commit({ name, value }) { const t = now(); const r = engine.commit(name, value); return { r, ms: Math.round(now() - t), changes: changesFor(engine.drainChanges()), log: logSummary() }; },
  toggle({ name, widget }) { const t = now(); const r = engine.toggle(name, widget); return { r, ms: Math.round(now() - t), changes: changesFor(engine.drainChanges()), log: logSummary() }; },
  press({ name, widget }) { const t = now(); const r = engine.press(name, widget); return { r, ms: Math.round(now() - t), changes: changesFor(engine.drainChanges()), log: logSummary() }; },
  log() { return logSummary(); },
  names({ pattern }) { const re = new RegExp(pattern); return engine.fieldNames().filter((n) => re.test(n)); },
  selftest() {
    const timings = [];
    for (let i = 0; i < MPMBSelfTest.steps.length; i++) {
      const [op, f, v] = MPMBSelfTest.steps[i];
      const t = now();
      engine[op](f, v);
      timings.push({ step: f + ' = ' + v, ms: Math.round(now() - t) });
    }
    engine.drainChanges();
    const results = MPMBSelfTest.evaluate((n) => { const s = engine.snapshot(n); return s.exists ? (Array.isArray(s.value) ? s.value.join(',') : s.value) : '(missing)'; });
    return { results, timings, errors: engine.log.errors.slice(-20) };
  },
};

self.onmessage = async (e) => {
  const { id, op, args } = e.data || {};
  try {
    if (!ops[op]) throw new Error('Unknown request: ' + op);
    if (op !== 'open' && !engine) throw new Error('No sheet loaded');
    const result = await ops[op](args || {});
    postMessage({ id, ok: true, result });
  } catch (err) {
    postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};
postMessage({ type: 'ready' });
})();
