// MPMB's Text Options (Functions > Text Options): its menu, the font / font size / line spacing dialog, lines on
// multi-line fields and unicode. Then the changes kept through the autosave and written into the PDF (DA and the
// field drawn with the new font), read back by the loader as a new sheet.
// Writes test/saved-textoptions.pdf (gitignored) to open in Acrobat.
const fs = require('fs'), path = require('path'), vm = require('vm');
const PDFLib = require('pdf-lib');
const SRC = path.join(__dirname, '..', 'src');
const { load } = require(path.join(SRC, 'loader.js'));
const { write } = require(path.join(SRC, 'writer.js'));
const selftest = require(path.join(SRC, 'selftest.js'));
const content = require(path.join(SRC, 'content.js'));
const engineSrc = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
function newEngine(modelJSON, state) {
  const ctx = vm.createContext({ __modelJSON: modelJSON });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(engineSrc, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const engine = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  if (state) engine.importState(state);
  engine.start();
  content.restore(engine);
  engine.drainChanges();
  return engine;
}
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(48), detail === undefined ? '' : String(detail).slice(0, 200)); };
const find = (items, re) => { for (const i of items || []) { if (i.items) { const f = find(i.items, re); if (f) return f; } else if (re.test(i.name) || re.test(i.ret)) return i; } return null; };
const DIALOG = 'Set the Font and the Font Size';

(async () => {
  const modelJSON = fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8');
  const e = newEngine(modelJSON);
  for (const [op, f, v] of selftest.steps) e[op](f, v);
  e.commit('PC Name', 'Ilvara');
  e.drainChanges();
  const prop = (n, p) => e.evalExpr('tDoc.getField(' + JSON.stringify(n) + ').' + p);
  const typePF = !!e.evalExpr('typePF');
  function bookmark(answers, dialogs) {
    e.clearQueues();
    for (const a of answers || []) e.queueMenu(a);
    for (const d of dialogs || []) e.queueDialog(d);
    e.runBookmark(['Functions', 'Text Options']);
    const m = e.takeMenu(); e.clearQueues(); return m;
  }

  // the menu
  const menu = bookmark();
  const names = (menu || []).map((i) => i.name).filter((n) => n !== '-');
  check('menu: font dialog, multi-line lines, unicode', !!find(menu, /#dodialog$/) && !!find(menu, /#hide lines$/) && !!find(menu, /^unicode#/), names.join(' | '));
  check('menu: single-line boxes only on Printer Friendly', !!find(menu, /#calc_boxes$/) === typePF, 'typePF ' + typePF);
  check('opening the menu changes nothing', e.drainChanges().length === 0);

  // the app has shown the rich text fields (their Format ran, so MPMB knows them: mpmbRtFormat), as in Acrobat
  for (const n of ['Class Features', 'Racial Traits']) e.snapshot(n);
  // the dialog: font size 8, Garamond, line spacing 12
  const before = { size: prop('Class Features', 'textSize'), font: prop('PC Name', 'textFont') };
  bookmark([find(menu, /#dodialog$/).ret], [{ name: DIALOG, steps: [
    { set: { sOth: true, sOSi: '8' }, press: 'sOth' },
    { set: { fAlt: true }, pick: { id: 'fAlS', item: 'Garamond' }, press: 'fAlS' },
    { set: { lOth: true, lOSi: '12' } },
  ] }]);
  const dlg = e.log.dialogs[e.log.dialogs.length - 1];
  check('the dialog opened', dlg && dlg.name === DIALOG, dlg && dlg.name);
  const errs = e.log.errors.filter((x) => /dialog|Text|Font/i.test(x.where || x.msg || ''));
  check('no errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
  check('multi-line fields get font size 8', prop('Class Features', 'textSize') === 8 && prop('Racial Traits', 'textSize') === 8, before.size + ' → ' + prop('Class Features', 'textSize'));
  check('fonts change to Garamond', prop('PC Name', 'textFont') === 'Garamond' && prop('Class Features', 'textFont') === 'Garamond', before.font + ' → ' + prop('PC Name', 'textFont'));
  check('rich text stays on for MPMB formatted fields', !!prop('Class Features', 'richText'));
  check('MPMB remembers size and line spacing', e.evalExpr('CurrentVars.fontsize') === 8 && e.evalExpr('CurrentVars.linespacing') === 12, e.evalExpr('CurrentVars.fontsize') + ' / ' + e.evalExpr('CurrentVars.linespacing'));

  // lines on multi-line fields: hide (the whiteout fields show), then show again
  const white = () => Number(e.evalExpr('tDoc.getField("Whiteout.Standard.0").display'));
  const whiteBefore = white();
  bookmark([find(menu, /#hide lines$/).ret]);
  check('Hide lines shows the whiteout fields', white() === 0 && e.evalExpr('CurrentVars.whiteout') === true, whiteBefore + ' → ' + white());

  // unicode off and on again (MPMB says so in an alert)
  const uni = () => String(e.evalExpr('What("UseUnicode")'));
  const uniBefore = uni();
  const nAlerts = e.log.alerts.length;
  let m2 = bookmark();
  bookmark([find(m2, /^unicode#/).ret]);
  check('Use Unicode toggles', uni() !== uniBefore, JSON.stringify(uniBefore) + ' → ' + JSON.stringify(uni()));
  check('MPMB reports the change', e.log.alerts.length > nAlerts && /unicode/i.test(e.log.alerts[e.log.alerts.length - 1].title), e.log.alerts.length > nAlerts ? e.log.alerts[e.log.alerts.length - 1].title : 'no alert');
  m2 = bookmark();
  bookmark([find(m2, /^unicode#/).ret]);
  check('…and back', uni() === uniBefore);

  // a font that isn't in the sheet's /DR (SegoeUI-Semibold) on a second engine, for the writer
  const state = e.exportState();

  // the autosave keeps it
  const r = newEngine(modelJSON, JSON.parse(JSON.stringify(state)));
  check('autosave: size, font and lines kept', r.evalExpr('tDoc.getField("Class Features").textSize') === 8 && r.evalExpr('tDoc.getField("PC Name").textFont') === 'Garamond'
    && Number(r.evalExpr('tDoc.getField("Whiteout.Standard.0").display')) === 0);

  // into the PDF
  const bytes = fs.readFileSync(path.join(__dirname, 'sheet.pdf'));
  state.look = e.appearanceData(Object.keys(state.fields));
  state.lookLineHeight = Number(e.evalExpr('CurrentVars.linespacing'));
  const out = await write(new Uint8Array(bytes), state, PDFLib);
  const outBytes = out.bytes || out;
  fs.writeFileSync(path.join(__dirname, 'saved-textoptions.pdf'), outBytes);
  const doc = await PDFLib.PDFDocument.load(outBytes, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  const da = (n) => { const f = form.getField(n); const v = f.acroField.dict.lookup(PDFLib.PDFName.of('DA')); return v ? v.decodeText ? v.decodeText() : String(v.asString ? v.asString() : v) : ''; };
  check('PDF: Class Features DA is Garamond 8', /\/Garamond 8 Tf/.test(da('Class Features')), da('Class Features'));
  check('PDF: name DA is Garamond', /\/Garamond [\d.]+ Tf/.test(da('PC Name')), da('PC Name'));
  // the appearance of the name uses Garamond
  const w = form.getField('PC Name').acroField.getWidgets()[0];
  const ap = w.dict.lookup(PDFLib.PDFName.of('AP'));
  const n = ap && ap.lookup(PDFLib.PDFName.of('N'));
  let apText = '', apFonts = [];
  if (n instanceof PDFLib.PDFRawStream) {
    apText = Buffer.from(PDFLib.decodePDFRawStream(n).decode()).toString('latin1');
    const res = n.dict.lookup(PDFLib.PDFName.of('Resources')); const fr = res && res.lookup(PDFLib.PDFName.of('Font'));
    if (fr) for (const [k, v] of fr.entries()) apFonts.push(k.toString() + '=' + String(doc.context.lookup(v).get(PDFLib.PDFName.of('BaseFont'))));
  }
  const hex = (apText.match(/<([0-9a-fA-F]+)>/g) || []).map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1')).join('');
  check('PDF: the name is drawn with Garamond', /Garamond/.test(apFonts.join(' ')) && /Ilvara/.test(apText + hex), apFonts.join(' ') + ' ' + apText.replace(/\s+/g, ' ').slice(0, 80));

  // read back as a new sheet
  const model2 = await load(outBytes, PDFLib);
  const e2 = newEngine(JSON.stringify(model2));
  check('new sheet: size, font and line spacing', e2.evalExpr('tDoc.getField("Class Features").textSize') === 8 && e2.evalExpr('tDoc.getField("PC Name").textFont') === 'Garamond' && e2.evalExpr('CurrentVars.linespacing') === 12,
    e2.evalExpr('tDoc.getField("Class Features").textSize') + ' ' + e2.evalExpr('tDoc.getField("PC Name").textFont') + ' ' + e2.evalExpr('CurrentVars.linespacing'));

  // a font the sheet has no resource for: the writer adds one to /DR, as Acrobat does
  const e3 = newEngine(modelJSON);
  e3.commit('PC Name', 'Ilvara');
  e3.clearQueues(); e3.queueMenu('text#dodialog');
  e3.queueDialog({ name: DIALOG, steps: [{ set: { fAlt: true }, pick: { id: 'fAlS', item: 'SegoeUI-Semibold' }, press: 'fAlS' }] });
  e3.runBookmark(['Functions', 'Text Options']); e3.clearQueues();
  check('SegoeUI-Semibold applied', e3.evalExpr('tDoc.getField("PC Name").textFont') === 'SegoeUI-Semibold', e3.evalExpr('tDoc.getField("PC Name").textFont'));
  const st3 = e3.exportState(); st3.look = e3.appearanceData(Object.keys(st3.fields));
  const out3 = await write(new Uint8Array(bytes), st3, PDFLib);
  const doc3 = await PDFLib.PDFDocument.load(out3.bytes || out3, { ignoreEncryption: true, updateMetadata: false });
  const dr = doc3.catalog.lookup(PDFLib.PDFName.of('AcroForm')).lookup(PDFLib.PDFName.of('DR')).lookup(PDFLib.PDFName.of('Font'));
  const semi = dr.lookup(PDFLib.PDFName.of('SegoeUI-Semibold'));
  check('PDF: /DR has a SegoeUI-Semibold font', !!semi && /SegoeUI-Semibold/.test(String(semi.get(PDFLib.PDFName.of('BaseFont')))), semi ? String(semi.get(PDFLib.PDFName.of('BaseFont'))) : 'missing');

  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
