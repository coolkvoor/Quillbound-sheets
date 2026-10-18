/* The engine worker: loads the PDF, runs MPMB's code, and answers the app's requests.
 * Each worker is one sheet (one JavaScript realm), because MPMB changes built-in prototypes. */
'use strict';
// In the single-file build everything is already bundled in front of this file
if (!self.MPMBEngine) {
  try { importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'); } catch (e) { importScripts('vendor/pdf-lib.min.js'); }
  importScripts('loader.js', 'engine.js', 'selftest.js', 'content.js', 'spells.js', 'writer.js', 'classes.js', 'abilities.js');
}
// Everything below stays out of the global scope, which belongs to MPMB's code
(function () {

let engine = null;
let sheetBytes = null;   // the PDF as opened: the base the character is written into (writer.js)
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
function actionOp(fn) {
  const t = now();
  const r = fn();
  return { alerts: r.alerts || [], errors: r.errors || [], ms: Math.round(now() - t), changes: changesFor(engine.drainChanges()), log: logSummary() };
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
    sheetBytes = new Uint8Array(bytes);
    const model = await MPMBLoader.load(sheetBytes, self.PDFLib, progress);
    const loadMs = Math.round(now() - t0);
    const names = model.docScripts.map((s) => s.name);
    if (names.indexOf('Startup') === -1 || !model.info.SheetVersion) throw new Error('NOT_MPMB');
    progress(state ? 'Starting MPMB’s scripts with your character' : saved ? 'Starting MPMB’s scripts and your add-on content' : 'Starting MPMB’s scripts');
    engine = MPMBEngine.createEngine(model, { global: self, evalGlobal }, { fileName });
    const restoredChar = state ? engine.importState(state) : false;
    if (!restoredChar && saved) engine.preset(saved);
    // MPMB asks whether to raise the level when the XP total reaches a new one; the app asks the user itself
    // (Level up opens the class screen), so MPMB's question is answered "not now"
    engine.setStandingAnswer('EXPERIENCE POINTS DIALOG', { steps: [{ end: 'cancel' }] });
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
  // Spend one piece of ammunition the way the sheet does: tick the next box (MPMB counts down); if the boxes aren't
  // shown (MPMB draws different ones per kind of ammunition), lower the amount instead. To restock, type the amount.
  shootAmmo({ side }) {
    const t = now(), seq = engine.logSeq;
    const pre = side === 'right' ? 'AmmoRight' : 'AmmoLeft';
    let done = false;
    for (let i = 1; i <= 50 && !done; i++) {
      const s = engine.snapshot(pre + '.Bullet.' + i);
      if (s.exists && !s.hidden && !s.checked) { engine.toggle(pre + '.Bullet.' + i); done = true; }
    }
    if (!done) { const n = Number(engine.snapshot(pre + 'Display.Amount').value) || 0; if (n > 0) engine.commit(pre + 'Display.Amount', String(n - 1)); }
    return { alerts: engine.log.alerts.filter((a) => a.seq > seq).map((a) => ({ title: a.title, msg: a.msg })), ms: Math.round(now() - t), changes: changesFor(engine.drainChanges()), log: logSummary() };
  },
  // level by experience points, by MPMB's own table
  xpInfo() { return JSON.parse(engine.evalExpr('JSON.stringify((function () { var lv = Number(What("Character Level")) || 0; var r = getCurrentLevelByXP(lv, What("Total Experience")); return { level: lv, xpLevel: r[0], table: ExperiencePointsList }; })())')); },
  // the sheet's optional pages, as MPMB keeps track of them: shown or not, and for pages that can be added more than
  // once (companion, notes, wild shapes, logsheet, spell sheets) the field prefix of each copy ("P4.AScomp.")
  pageList() {
    return JSON.parse(engine.evalExpr('JSON.stringify(["ASfront", "ASoverflow", "ASbackgr", "AScomp", "ASnotes", "WSfront", "ALlog", "SSfront"].map(function (t) {'
      + ' var multi = TemplatesWithExtras.indexOf(t) !== -1;'
      + ' var prefixes = multi && tDoc.getField("Template.extras." + t) ? What("Template.extras." + t).split(",").slice(1) : [];'
      + ' return { key: t, shown: !!isTemplVis(t), multi: multi, prefixes: prefixes }; }))'));
  },
  // a page MPMB can add more than once (a companion page): added with MPMB's own page function
  addPage({ key }) {
    if (['AScomp', 'ASnotes', 'WSfront', 'ALlog'].indexOf(key) === -1) throw new Error('Unknown page: ' + key);
    // as an action: MPMB restarts calculations from a timer (calcCont), which fills the new page's calculated fields
    return actionOp(() => { engine.action('DoTemplate("' + key + '", "Add")', 'addPage'); return {}; });
  },
  // the Notes pages' text, and removing all of them with MPMB's own page removal (no question: the app asked)
  notesText() {
    return JSON.parse(engine.evalExpr('JSON.stringify(What("Template.extras.ASnotes").split(",").slice(1).map(function (p) {'
      + ' return { prefix: p, left: String(What(p + "Notes.Left") || ""), right: String(What(p + "Notes.Right") || "") }; }))'));
  },
  clearNotesPages() { return actionOp(() => { engine.action('DoTemplate("ASnotes", "RemoveAll", false, true)', 'clearNotesPages'); return {}; }); },
  // suggestions for the tool lines: MPMB's tools (with add-on content)
  toolNames() { return JSON.parse(engine.evalExpr('JSON.stringify((function () { var r = []; for (var k in ToolsList) { var n = ToolsList[k].name || k; if (r.indexOf(n) === -1) r.push(n); } return r.sort(); })())')); },
  // The character written into the sheet's own PDF (writer.js); the bytes go back to the app to offer as a download
  async savePdf() {
    const t = now();
    const r = await MPMBWriter.write(sheetBytes, engine.exportState(), self.PDFLib, progress);
    return { bytes: r.bytes, report: r.report, ms: Math.round(now() - t) };
  },
  // add-on content and sources: MPMB's own dialogs, answered for the user (content.js)
  addContent({ text }) { return contentOp(() => MPMBContent.addFile(engine, text)); },
  removeContent({ key }) { return contentOp(() => MPMBContent.removeFile(engine, key)); },
  setUserScript({ text }) { return contentOp(() => MPMBContent.setUserScript(engine, text)); },
  setSources({ excluded }) { return contentOp(() => MPMBContent.setSources(engine, excluded)); },
  // A tap on one of MPMB's buttons (or a bookmark) that may open menus. answers: the menu choices so far, in order.
  // If the action opens a menu nobody answered yet, it comes back as `menu` and the app asks the user, then taps again.
  // A yes/no question MPMB asks on the way comes back as `question` (answered No this time); the app asks the user and
  // taps again with the answers so far in `yes` (true/false, in order).
  tap({ name, widget, bookmark, answers, modifier, yes }) {
    const t = now(), seq = engine.logSeq;
    engine.clearQueues();
    for (const a of answers || []) engine.queueMenu(a);
    for (const y of yes || []) engine.queueAnswer(y);
    engine.askQuestions(true);
    try { if (bookmark) engine.runBookmark(bookmark); else engine.press(name, widget || 0, { modifier: !!modifier }); }
    finally { engine.askQuestions(false); }
    const menu = engine.takeMenu(), question = engine.takeQuestion();
    engine.clearQueues();
    // what MPMB showed: alerts (not its questions, which the app asks), and dialogs that only show text, in order
    const shown = engine.log.alerts.filter((a) => a.seq > seq && !a.question).map((a) => ({ seq: a.seq, title: a.title, msg: a.msg }))
      .concat(engine.log.dialogs.filter((d) => d.seq > seq && d.text).map((d) => ({ seq: d.seq, title: d.title, msg: d.text })))
      .sort((a, b) => a.seq - b.seq).map((x) => ({ title: x.title, msg: x.msg }));
    return { menu, question, alerts: shown, ms: Math.round(now() - t), changes: changesFor(engine.drainChanges()), log: logSummary() };
  },
  // Spells (spells.js)
  spellOptions() { return MPMBSpells.options(engine); },
  spellSheet() { return MPMBSpells.sheet(engine); },
  spellDetails({ key }) { return MPMBSpells.details(engine, key); },
  chooseSpells({ picks }) { return spellOp(() => MPMBSpells.choose(engine, picks)); },
  removeSpells() { return spellOp(() => MPMBSpells.remove(engine)); },
  // Classes and ability scores: MPMB's dialogs, edited on the app's screens (classes.js, abilities.js)
  classOptions() { return MPMBClasses.options(engine); },
  applyClasses({ rows }) { return actionOp(() => MPMBClasses.apply(engine, rows)); },
  // Feature texts saved by a version before the line-break fix are out of order; MPMB rewrites them when the classes
  // are removed and added back (applying the same classes again changes nothing)
  rebuildClassText() {
    return actionOp(() => {
      const o = MPMBClasses.options(engine);
      const rows = o.rows.filter((r) => r.cls).map((r) => ({ cls: r.cls, sub: r.sub, level: r.level }));
      if (!rows.length) return { alerts: [], errors: [] };
      const a = MPMBClasses.apply(engine, []);
      // whatever MPMB didn't recognise as a class feature while removing (old scraps) would stay in the field and
      // throw off where it inserts the features again, so start from an empty field
      engine.evalExpr('Value("Class Features", "")');
      const b = MPMBClasses.apply(engine, rows);
      return { alerts: a.alerts.concat(b.alerts), errors: a.errors.concat(b.errors) };
    });
  },
  abilityOptions() { return MPMBAbilities.options(engine); },
  abilityPreview({ scores }) { return MPMBAbilities.preview(engine, scores); },
  applyAbilities({ scores }) { return actionOp(() => MPMBAbilities.apply(engine, scores)); },
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
