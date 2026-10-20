// MPMB's 2014 sheets (v14): each 2014 sheet PDF in resources/ (or the files given) opens, builds the self-test
// character (with the 2014 species name), and the parts that differ from the 2024 sheets work: the lines the app
// counts per sheet (worker.js ROWS), the 2014 conditions and exhaustion boxes (Colorful only), Wild Shape uses and a
// shape on a Wild Shapes page, and writing the character into the PDF and reading it back as a new sheet.
// Skips when resources/ has no 2014 sheet (the owner's own files, gitignored).
const fs = require('fs'), path = require('path'), vm = require('vm');
const PDFLib = require('pdf-lib');
const SRC = path.join(__dirname, '..', 'src');
const { load } = require(path.join(SRC, 'loader.js'));
const { write } = require(path.join(SRC, 'writer.js'));
const content = require(path.join(SRC, 'content.js'));
const selftest = require(path.join(SRC, 'selftest.js'));
const ENGINE = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
const RES = path.join(__dirname, '..', 'resources');
// the worker's line counts (worker.js runs in a Web Worker; its ROWS table is read from the source)
const workerSrc = fs.readFileSync(path.join(SRC, 'worker.js'), 'utf8');
const rowsSrc = workerSrc.slice(workerSrc.indexOf('const ROWS = {'), workerSrc.indexOf('const ops = {'));
const rowCounts = new Function(rowsSrc + '\nreturn rowCounts;')();

function newEngine(model, state) {
  const ctx = vm.createContext({ __modelJSON: typeof model === 'string' ? model : JSON.stringify(model) });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(ENGINE, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  if (state) e.importState(JSON.parse(JSON.stringify(state)));
  e.start();
  content.restore(e);
  e.drainChanges();
  return e;
}
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(50), detail === undefined ? '' : String(detail).slice(0, 200)); };

(async () => {
  const files = process.argv.length > 2 ? process.argv.slice(2)
    : fs.existsSync(RES) ? fs.readdirSync(RES).filter((f) => /\(v14[^)]*\).*\.pdf$/i.test(f)).map((f) => path.join(RES, f)) : [];
  if (!files.length) { console.log('SKIP: no 2014 (v14) sheet in resources/'); return; }
  for (const file of files) {
    console.log('\n=== ' + path.basename(file));
    const bytes = fs.readFileSync(file);
    const model = await load(bytes, PDFLib);
    const pf = /printer friendly/i.test(model.info.SheetType), a4 = /a4/i.test(model.info.SheetType);
    const e = newEngine(model);
    const val = (n) => String(e.snapshot(n).value);
    check('MPMB starts without errors', e.log.errors.length === 0, e.log.errors.slice(0, 3).map((x) => x.where + ': ' + x.msg).join(' | '));
    check('a 2014 sheet', /^14/.test(String(model.info.SheetVersion)) && /^14/.test(String(e.evalExpr('sheetVersion'))), model.info.SheetVersion);

    // the lines per sheet type, as MPMB itself counts them (FieldNumbers)
    const rc = rowCounts(model), fn = JSON.parse(e.evalExpr('JSON.stringify(FieldNumbers)'));
    check('lines: attacks, gear, extra gear as MPMB counts them', rc.attacks === fn.attacks && rc.gear === fn.gear && rc.xgear === fn.extragear && rc.Language === fn.langstools && rc.compGear === fn.compgear,
      JSON.stringify({ attacks: rc.attacks, gear: rc.gear, xgear: rc.xgear, lang: rc.Language, compGear: rc.compGear }));
    check('lines: actions and magic items as MPMB counts them', rc.Action === fn.trueactions && rc.magic === fn.magicitems, rc.Action + ' actions, ' + rc.magic + ' magic items');
    check('conditions: 2014 boxes on Colorful, none on Printer Friendly', pf ? rc.cond14 === 0 && rc.cond24 === 0 : rc.cond14 === 14 && rc.exh14 === 6 && rc.cond24 === 0, JSON.stringify([rc.cond14, rc.exh14, rc.cond24]));

    // the self-test character, with the 2014 species
    const steps = selftest.steps.map((s) => (s[1] === 'Race' ? ['commit', 'Race', 'High Elf'] : s));
    for (const [op, f, v] of steps) e[op](f, v);
    e.drainChanges();
    // (2014's elf text says "charmed" in lower case)
    const res = selftest.evaluate((n) => { const s = e.snapshot(n); return s.exists ? (Array.isArray(s.value) ? s.value.join(',') : s.value) : '(missing)'; });
    for (const r of res) if (!r.ok && r.field === 'Saving Throw advantages / disadvantages') r.ok = /charmed/i.test(r.value);
    check('self-test (High Elf Wizard 3)', res.every((r) => r.ok), res.filter((r) => !r.ok).map((r) => r.label + ': ' + JSON.stringify(r.value)).join(' | ') || res.length + '/' + res.length);

    if (!pf) {
      // MPMB's ConditionSet: Poisoned gives disadvantage on attacks and ability checks; exhaustion levels tick up to the one picked
      e.toggle('Extra.Condition 10');
      check('Poisoned: disadvantage on attacks', e.snapshot('Extra.Condition 10').checked && e.snapshot('Att Dis').checked);
      e.toggle('Extra.Condition 10');
      check('Poisoned off again', !e.snapshot('Att Dis').checked);
      e.toggle('Extra.Exhaustion Level 2');
      check('exhaustion 2 ticks levels 1 and 2', [1, 2, 3].map((i) => (e.snapshot('Extra.Exhaustion Level ' + i).checked ? 1 : 0)).join('') === '110');
      e.toggle('Extra.Exhaustion Level 2');
    }

    // Wild Shape: the 2014 details (uses, no known forms), a page and a shape on it
    e.commit('Class and Levels', 'Druid 2');
    check('Druid 2: Wild Shape uses', /2×? per short rest/i.test(val('Wildshapes.Info.Uses')) && !e.snapshot('Wildshapes.Info.KnownForms').exists, val('Wildshapes.Info.Uses'));
    e.action('DoTemplate("WSfront", "Add")', 'addPage');
    const P = String(e.evalExpr('What("Template.extras.WSfront")')).split(',')[1] || '';
    check('Wild Shapes page added', /WSfront\.$/.test(P) && val(P + 'Wildshapes.Info.Uses') === val('Wildshapes.Info.Uses'), P);
    e.commit(P + 'Wildshape.Race.1', 'Wolf');
    const W = P + 'Wildshape.1.';
    check('Wolf on the page (2014: AC 13, Bite +4 2d4+2)', val(W + 'AC') === '13' && val(W + 'Attack.1.To Hit') === '+4' && /2d4\+2/.test(val(W + 'Attack.1.Damage')), [val(W + 'AC'), val(W + 'Attack.1.To Hit'), val(W + 'Attack.1.Damage')].join(' '));
    check('Wolf hit points' + (pf ? '' : ' (Colorful too)'), val(W + 'HP Max') !== '' && e.snapshot(W + 'HD').exists, val(W + 'HP Max') + ' / ' + val(W + 'HD'));
    // Colorful: MPMB's skill name button cycles a combo box; Printer Friendly: plain Prof / Exp boxes
    if (pf) { e.toggle(W + 'Skills.Ath.Prof'); check('skill box: proficient', e.snapshot(W + 'Skills.Ath.Prof').checked && val(W + 'Skills.Ath.Mod') !== ''); }
    else { e.press(P + 'Text.Wildshape.1.Skills.Ath.Name', 0); check('skill dot: proficient', val(P + 'Text.Wildshape.1.Skills.Ath.Prof') === 'proficient'); }
    e.commit('PC Name', 'Ilvara');
    e.commit('HP Max', '17'); e.commit('HP Current', '12');
    check('no script errors', e.log.errors.length === 0, e.log.errors.slice(0, 3).map((x) => x.where + ': ' + x.msg).join(' | '));

    // autosave and the PDF: restored into a fresh sheet, and written into the PDF and read back as a new sheet
    const st = e.exportState();
    const r1 = newEngine(model, st);
    check('restored from the autosave', String(r1.snapshot(P + 'Wildshape.Race.1').value) === 'Wolf' && String(r1.snapshot('Class and Levels').value) === val('Class and Levels'), String(r1.snapshot('Class and Levels').value));
    st.look = e.appearanceData(Object.keys(st.fields));
    st.lookLineHeight = Number(e.evalExpr('CurrentVars.linespacing !== undefined ? CurrentVars.linespacing : typePF ? 11 : 10'));
    const out = await write(new Uint8Array(bytes), st, PDFLib);
    check('write: PDF made, nothing skipped', out.bytes.length > 1e6 && out.report.skipped.length === 0, (out.bytes.length / 1048576).toFixed(1) + ' MB; ' + out.report.skipped.slice(0, 4).join(' | '));
    const m2 = await load(out.bytes, PDFLib);
    const e2 = newEngine(m2);
    const keys = ['PC Name', 'Race', 'Class and Levels', 'Character Level', 'HP Max', 'HP Current', 'AC', 'Wildshapes.Info.Uses', P + 'Wildshape.Race.1', W + 'AC'];
    const diff = keys.filter((k) => String(e2.snapshot(k).value) !== val(k));
    check('read back: the character is in the PDF', diff.length === 0 && e2.log.errors.length === 0, diff.map((k) => k + ': ' + val(k) + ' → ' + e2.snapshot(k).value).join(' | ') || keys.length + ' fields match');
    if (a4 && !pf) fs.writeFileSync(path.join(__dirname, 'saved-2014.pdf'), out.bytes);
  }
  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error(err); process.exit(1); });
