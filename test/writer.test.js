// Writing the character into the PDF: build a character, write it with writer.js, then read that PDF back with the
// loader and start MPMB on it as a brand-new sheet (no saved state): the character must be in the file itself.
// Writes test/saved-character.pdf (gitignored) so it can be opened in Acrobat.
const fs = require('fs'), path = require('path'), vm = require('vm');
const PDFLib = require('pdf-lib');
const SRC = path.join(__dirname, '..', 'src');
const { load } = require(path.join(SRC, 'loader.js'));
const { write, REDRAW_SCRIPT } = require(path.join(SRC, 'writer.js'));
const selftest = require(path.join(SRC, 'selftest.js'));
const content = require(path.join(SRC, 'content.js'));
const spells = require(path.join(SRC, 'spells.js'));
const engineSrc = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
function newEngine(modelJSON) {
  const ctx = vm.createContext({ __modelJSON: modelJSON });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(engineSrc, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const engine = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  engine.start();
  content.restore(engine);
  engine.drainChanges();
  return engine;
}
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(44), detail === undefined ? '' : String(detail).slice(0, 200)); };

(async () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'sheet.pdf'));
  const e = newEngine(fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8'));
  for (const [op, f, v] of selftest.steps) e[op](f, v);
  e.commit('PC Name', 'Ilvara');
  e.clearQueues(); e.queueMenu('elf#high'); e.press('Race Features Menu', 0); e.clearQueues();
  e.commit('Feat Name 1', 'Alert');
  e.commit('Adventuring Gear Row 1', 'Rope');
  e.commit('Extra.Magic Item 1', 'Cloak of Protection');
  e.commit('Limited Feature Used 1', '1');
  e.commit('HP Max', '17'); e.commit('HP Current', '12');
  e.toggle('Inspiration');
  spells.choose(e, { wizard: { cantrips: ['fire bolt', 'mage hand', 'light'], spells: ['magic missile', 'shield', 'sleep', 'detect magic', 'mage armor', 'burning hands'], prepared: ['magic missile', 'shield', 'sleep', 'mage armor', 'detect magic', 'burning hands'], show: 3 } });
  const KEYS = ['PC Name', 'Race', 'Racial Traits', 'Class and Levels', 'Character Level', 'Int Mod', 'Int ST Mod', 'Arc', 'AC', 'HP Max', 'HP Current', 'Inspiration', 'Limited Feature 1', 'Limited Feature Used 1', 'Feat Name 1', 'Feat Description 1', 'Adventuring Gear Row 1', 'Adventuring Gear Weight 1', 'Extra.Magic Item 1', 'Extra.Magic Item Description 1', 'Attack.2.To Hit', 'Class Features'];
  const want = {};
  for (const k of KEYS) want[k] = String(e.snapshot(k).value);
  const sheet1 = spells.sheet(e);
  const st = e.exportState();

  let t = Date.now();
  const res = await write(new Uint8Array(bytes), st, PDFLib);
  const writeMs = Date.now() - t;
  check('write: PDF made', res.bytes.length > 1e6, (res.bytes.length / 1048576).toFixed(1) + ' MB in ' + writeMs + ' ms; ' + JSON.stringify(Object.assign({}, res.report, { skipped: res.report.skipped.length })));
  check('write: nothing skipped', res.report.skipped.length === 0, res.report.skipped.slice(0, 8).join(' | '));
  fs.writeFileSync(path.join(__dirname, 'saved-character.pdf'), res.bytes);

  t = Date.now();
  const m2 = await load(res.bytes, PDFLib);
  check('read back: the loader reads it', m2.docScripts.length === 28 && m2.pageCount === 7, m2.pageCount + ' pages, ' + m2.fieldOrder.length + ' fields, ' + (Date.now() - t) + ' ms');
  // Acrobat redraws the fields before MPMB's scripts are loaded: the app's last document script redraws MPMB's
  // formatted fields once (feature texts, "+2"), then marks the PDF done
  const redraw = m2.docScripts[m2.docScripts.length - 1];
  check('redraw script: after MPMB\'s scripts', redraw.name === REDRAW_SCRIPT && m2.docScripts.slice(0, -1).every((s) => s.name < redraw.name), m2.docScripts.map((s) => s.name).slice(-2).join(', '));
  check('redraw script: the PDF asks for it', m2.info.MPMBSheetAppRedraw === 'yes', m2.info.MPMBSheetAppRedraw);
  const touched = [];
  const fakeDoc = { info: { MPMBSheetAppRedraw: 'yes' }, getField: (n) => (m2.fields[n] ? { type: m2.fields[n].type === 'Tx' ? 'text' : 'other', set password(v) { touched.push(n); } } : null) };
  vm.runInNewContext('(function () {' + redraw.code + '}).call(doc)', { doc: fakeDoc });
  check('redraw script: redraws the formatted fields', touched.indexOf('Class Features') !== -1 && touched.indexOf('Acr') !== -1 && fakeDoc.info.MPMBSheetAppRedraw === 'done', touched.length + ' fields, flag ' + fakeDoc.info.MPMBSheetAppRedraw);
  touched.length = 0;
  vm.runInNewContext('(function () {' + redraw.code + '}).call(doc)', { doc: fakeDoc });
  check('redraw script: only once', touched.length === 0);
  const again = await load((await write(res.bytes, e.exportState(), PDFLib)).bytes, PDFLib);
  check('saving again keeps one redraw script', again.docScripts.filter((s) => s.name === REDRAW_SCRIPT).length === 1 && again.docScripts.length === 28, again.docScripts.length + ' scripts');
  const e2 = newEngine(JSON.stringify(m2));
  check('read back: MPMB starts without errors', e2.log.errors.length === 0, e2.log.errors.slice(0, 4).map((x) => x.where + ': ' + x.msg).join(' | '));
  const diffs = KEYS.filter((k) => String(e2.snapshot(k).value) !== want[k]);
  check('read back: the character is in the PDF', diffs.length === 0, diffs.map((k) => k + ': ' + JSON.stringify(String(e2.snapshot(k).value).slice(0, 40)) + ' (was ' + JSON.stringify(want[k].slice(0, 40)) + ')').join(' | ') || KEYS.length + ' fields match');
  const sheet2 = spells.sheet(e2);
  check('read back: the spell sheet page is in the PDF', sheet2.pages === 1 && sheet2.rows.map((r) => r.key).join() === sheet1.rows.map((r) => r.key).join(), sheet2.pages + ' page(s), ' + sheet2.rows.length + ' rows');
  // MPMB's hidden state (submitName, tooltips, hidden fields) came along: a few known ones
  const probes = [['HP Max', 'submitName'], ['Race Features Menu', 'display']];
  for (const [n, p] of probes) check('read back: ' + n + ' ' + p, String(e.getField(n)[p]) === String(e2.getField(n)[p]), JSON.stringify([e.getField(n)[p], e2.getField(n)[p]]));
  // and the whole state matches, field by field
  const s1 = e.exportState().fields, s2 = e2.exportState();
  const moreDiffs = Object.keys(s1).filter((n) => s1[n].v !== undefined && (!m2.fields[n] || String(e2.getField(n) ? e2.getField(n).valueAsString : '') !== String(e.getField(n).valueAsString)));
  check('read back: every changed value is in the PDF', moreDiffs.length === 0, moreDiffs.length + ' differ: ' + moreDiffs.slice(0, 8).join(', '));
  // it keeps working in the written PDF
  e2.commit('Class and Levels', 'Wizard 4');
  check('the written sheet still levels up', String(e2.snapshot('Character Level').value) === '4' && e2.log.errors.length === 0);
  console.log('wrote test/saved-character.pdf');
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error(err); process.exit(1); });
