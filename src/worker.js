/* The engine worker: loads the PDF, runs MPMB's code, and answers the app's requests.
 * Each worker is one sheet (one JavaScript realm), because MPMB changes built-in prototypes. */
'use strict';
// In the single-file build everything is already bundled in front of this file
if (!self.MPMBEngine) {
  try { importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'); } catch (e) { importScripts('vendor/pdf-lib.min.js'); }
  importScripts('loader.js', 'engine.js', 'selftest.js', 'content.js', 'spells.js');
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
function contentOp(fn) {
  const t = now();
  const r = fn();
  return { alerts: r.alerts, errors: r.errors, content: r.content, saved: MPMBContent.state(engine), ms: Math.round(now() - t), changes: changesFor(engine.drainChanges()), log: logSummary() };
}
function spellOp(fn) {
  const t = now();
  const r = fn();
  return { alerts: r.alerts, errors: r.errors, sheet: r.sheet, ms: Math.round(now() - t), changes: changesFor(engine.drainChanges()), log: logSummary() };
}
function logSummary() {
  const l = engine.log;
  return { alerts: l.alerts.slice(-40), dialogs: l.dialogs.slice(-40), menus: l.menus.slice(-20), errors: l.errors.slice(-40), unsupported: Object.assign({}, l.unsupported), urls: l.urls.slice(-10) };
}

const ops = {
  // saved: field values kept with this sheet in the app (add-on content and source choices), restored before MPMB starts
  // state: a saved character (engine.exportState), put back before MPMB starts; it includes the add-on content
  async open({ bytes, fileName, saved, state }) {
    try { evalGlobal('1+1'); } catch (e) { throw new Error('EVAL_BLOCKED'); }
    const t0 = now();
    const model = await MPMBLoader.load(new Uint8Array(bytes), self.PDFLib, progress);
    const loadMs = Math.round(now() - t0);
    const names = model.docScripts.map((s) => s.name);
    if (names.indexOf('Startup') === -1 || !model.info.SheetVersion) throw new Error('NOT_MPMB');
    progress(state ? 'Starting MPMB’s scripts with your character' : saved ? 'Starting MPMB’s scripts and your add-on content' : 'Starting MPMB’s scripts');
    engine = MPMBEngine.createEngine(model, { global: self, evalGlobal }, { fileName });
    const restoredChar = state ? engine.importState(state) : false;
    if (!restoredChar && saved) engine.preset(saved);
    const startMs = engine.start();
    // A saved PDF keeps the dropdowns MPMB filled; the app starts from the PDF as distributed (some lists empty, such as
    // magic items), so MPMB rebuilds them: Source Material → Apply. With saved content this also restores it.
    const restored = MPMBContent.restore(engine);
    engine.drainChanges();
    return {
      info: { title: model.info.Title || '', version: model.info.SheetVersion || '', type: model.info.SheetType || '', author: model.info.Author || '' },
      stats: { bytes: model.stats.bytes, loadMs, startMs, fields: model.fieldOrder.length, scripts: model.docScripts.length, pages: model.pageCount, templates: model.templates.length },
      content: restored.content,
      restoredChar,
      saved: MPMBContent.state(engine),
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
  exportState() { return engine.exportState(); },
  // add-on content and sources: MPMB's own dialogs, answered for the user (content.js)
  addContent({ text }) { return contentOp(() => MPMBContent.addFile(engine, text)); },
  removeContent({ key }) { return contentOp(() => MPMBContent.removeFile(engine, key)); },
  setUserScript({ text }) { return contentOp(() => MPMBContent.setUserScript(engine, text)); },
  setSources({ excluded }) { return contentOp(() => MPMBContent.setSources(engine, excluded)); },
  // A tap on one of MPMB's buttons (or a bookmark) that may open menus. answers: the menu choices so far, in order.
  // If the action opens a menu nobody answered yet, it comes back as `menu` and the app asks the user, then taps again.
  tap({ name, widget, bookmark, answers, modifier }) {
    const t = now(), seq = engine.logSeq;
    engine.clearQueues();
    for (const a of answers || []) engine.queueMenu(a);
    if (bookmark) engine.runBookmark(bookmark); else engine.press(name, widget || 0, { modifier: !!modifier });
    const menu = engine.takeMenu();
    engine.clearQueues();
    // what MPMB showed: alerts, and dialogs that only show text (both in the order they came)
    const shown = engine.log.alerts.filter((a) => a.seq > seq).map((a) => ({ seq: a.seq, title: a.title, msg: a.msg }))
      .concat(engine.log.dialogs.filter((d) => d.seq > seq && d.text).map((d) => ({ seq: d.seq, title: d.title, msg: d.text })))
      .sort((a, b) => a.seq - b.seq).map((x) => ({ title: x.title, msg: x.msg }));
    return { menu, alerts: shown, ms: Math.round(now() - t), changes: changesFor(engine.drainChanges()), log: logSummary() };
  },
  // Spells (spells.js)
  spellOptions() { return MPMBSpells.options(engine); },
  spellSheet() { return MPMBSpells.sheet(engine); },
  spellDetails({ key }) { return MPMBSpells.details(engine, key); },
  chooseSpells({ picks }) { return spellOp(() => MPMBSpells.choose(engine, picks)); },
  removeSpells() { return spellOp(() => MPMBSpells.remove(engine)); },
  tapSpellRow({ button }) { return spellOp(() => MPMBSpells.tapRow(engine, button)); },
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
