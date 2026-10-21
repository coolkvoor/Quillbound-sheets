// Writing the character into the PDF: build a character, write it with writer.js, then read that PDF back with the
// loader and start MPMB on it as a brand-new sheet (no saved state): the character must be in the file itself.
// Writes test/saved-character.pdf (gitignored) so it can be opened in Acrobat.
const fs = require('fs'), path = require('path'), vm = require('vm');
const PDFLib = require('pdf-lib');
const SRC = path.join(__dirname, '..', 'src');
const { load } = require(path.join(SRC, 'loader.js'));
const { write } = require(path.join(SRC, 'writer.js'));
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
  const bytes = fs.readFileSync((process.env.SHEET || path.join(__dirname, 'sheet.pdf')));
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
  // what the fields show, as the worker gives it when saving
  st.look = e.appearanceData(Object.keys(st.fields));
  st.lookLineHeight = Number(e.evalExpr('CurrentVars.linespacing !== undefined ? CurrentVars.linespacing : typePF ? 11 : 10'));

  let t = Date.now();
  const res = await write(new Uint8Array(bytes), st, PDFLib);
  const writeMs = Date.now() - t;
  check('write: PDF made', res.bytes.length > 1e6, (res.bytes.length / 1048576).toFixed(1) + ' MB in ' + writeMs + ' ms; ' + JSON.stringify(Object.assign({}, res.report, { skipped: res.report.skipped.length })));
  check('write: nothing skipped', res.report.skipped.length === 0, res.report.skipped.slice(0, 8).join(' | '));
  fs.writeFileSync(path.join(__dirname, 'saved-character.pdf'), res.bytes);

  t = Date.now();
  const m2 = await load(res.bytes, PDFLib);
  check('read back: the loader reads it', m2.docScripts.length === 27 && m2.pageCount === 7, m2.pageCount + ' pages, ' + m2.fieldOrder.length + ' fields, ' + (Date.now() - t) + ' ms');
  // how the fields look in the saved PDF: drawn by the writer from what MPMB's Format scripts show (appearance.js),
  // so Acrobat shows bold feature names and "+2" when the file opens, not MPMB's markup
  const out = await PDFLib.PDFDocument.load(res.bytes, { ignoreEncryption: true, updateMetadata: false });
  const octx = out.context, L = (o) => (o instanceof PDFLib.PDFRef ? octx.lookup(o) : o), N = PDFLib.PDFName.of;
  check('appearances: viewers aren\'t asked to redraw', !L(out.catalog.get(N('AcroForm'))).get(N('NeedAppearances')) && m2.docScripts.length === 27);
  const apOf = (name) => {
    const w = out.getForm().getField(name).acroField.getWidgets()[0];
    const ap = L(L(w.dict.get(N('AP'))).get(N('N')));
    const content = Buffer.from(PDFLib.decodePDFRawStream(ap).decode()).toString('latin1');
    const fonts = L(L(ap.dict.get(N('Resources'))).get(N('Font')));
    const texts = [];
    content.replace(/<([0-9a-f]*)> Tj/g, (m, h) => { texts.push(Buffer.from(h, 'hex').toString('latin1')); return m; });
    return { content, text: texts.join(''), fonts: fonts.values().map((f) => String(L(f).get(N('BaseFont')))), font: (k) => L(fonts.get(N(k))) };
  };
  const cf = apOf('Class Features');
  check('Class Features: no markup in what is drawn', cf.text.length > 200 && !/#|\*\*/.test(cf.text), JSON.stringify(cf.text.slice(0, 90)));
  check('Class Features: feature names in the bold font', cf.fonts.indexOf('/SegoePrint,Bold') !== -1, cf.fonts.join(' '));
  check('Class Features: the sheet\'s colour on the names', /0\.392 0\.141 0\.506 rg/.test(cf.content));
  // MPMB's diamonds (◆): none of the sheet's fonts has one (Acrobat takes it from a system font), so they're drawn
  const diamonds = (cf.content.match(/ l h f/g) || []).length;
  check('Class Features: MPMB\'s diamonds (◆) drawn', diamonds >= 4 && !/\?/.test(cf.text.replace(/\?\s*$/, '')), diamonds + ' diamonds');
  const shownAs = (n) => String(e.snapshot(n).display);
  check('skills show what MPMB shows ("+2")', ['Acr', 'Arc', 'Int Mod'].every((n) => apOf(n).text === shownAs(n)) && /^\+/.test(apOf('Acr').text), ['Acr', 'Arc', 'Int Mod'].map((n) => n + ' ' + apOf(n).text).join(', '));
  check('a name as typed', apOf('PC Name').text === 'Ilvara', apOf('PC Name').text);
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

  // a page added and removed again: its fields go completely. Empty field nodes left behind (no kids, no widget)
  // broke MPMB's scripts in Acrobat: its bookmarks and buttons stopped working.
  {
    const r = newEngine(fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8'));
    r.evalExpr('DoTemplate("AScomp", "Add")');
    const pre = String(r.evalExpr('What("Template.extras.AScomp")')).split(',').slice(1);
    r.clearQueues(); r.queueMenu('companion#remove_page'); r.queueAnswer(true);
    r.press(pre[1] + 'Companion.Options', 0);
    r.clearQueues();
    const after = String(r.evalExpr('What("Template.extras.AScomp")')).split(',').slice(1);
    const st2 = r.exportState();
    const ops = (st2.pageOps || []).map((o) => o[0] + ' ' + o[1]).join(', ');
    const res2 = await write(new Uint8Array(bytes), st2, PDFLib);
    const d = await PDFLib.PDFDocument.load(res2.bytes, { ignoreEncryption: true, updateMetadata: false });
    const dl = (o) => (o instanceof PDFLib.PDFRef ? d.context.lookup(o) : o);
    const empty = [];
    (function walk(arr, prefix) {
      for (const ref of arr.asArray()) {
        const n = dl(ref), t = dl(n.get(N('T'))), name = t ? (prefix ? prefix + '.' : '') + t.decodeText() : prefix;
        const kids = dl(n.get(N('Kids')));
        if (kids instanceof PDFLib.PDFArray && kids.size()) walk(kids, name);
        else if (!n.has(N('Rect'))) empty.push(name);
      }
    })(dl(dl(d.catalog.get(N('AcroForm'))).get(N('Fields'))), '');
    const m3 = await load(res2.bytes, PDFLib);
    const left = Object.keys(m3.fields).filter((n) => n.indexOf(pre[1]) === 0);
    check('page added and removed: MPMB removed it', pre.length === 2 && after.length === 1, pre.join() + ' → ' + after.join() + ' (' + ops + ')');
    check('page added and removed: no fields left', left.length === 0, left.length + ': ' + left.slice(0, 4).join(', '));
    check('page added and removed: no empty field nodes', empty.length === 0, empty.length + ': ' + empty.slice(0, 4).join(', '));
  }
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error(err); process.exit(1); });
