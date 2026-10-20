// MPMB's Direct Import (Import/Export → "Import a character directly from another MPMB's Character Sheet PDF"): the
// sheet to import from runs in its own realm, as a second document in Acrobat does, and app.openDoc hands it to the
// sheet that imports. Imports a built character from a PDF the app saved (writer.test.js) into a fresh sheet.
const fs = require('fs'), path = require('path'), vm = require('vm');
const PDFLib = require('pdf-lib');
const SRC = path.join(__dirname, '..', 'src');
const { load } = require(path.join(SRC, 'loader.js'));
const content = require(path.join(SRC, 'content.js'));
const ENGINE = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
function newEngine(modelJSON, opts) {
  const ctx = vm.createContext({ __modelJSON: modelJSON, __opts: opts || {} });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(ENGINE, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, __opts)');
  e.start();
  content.restore(e);
  e.drainChanges();
  e.ctx = ctx;
  return e;
}
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(50), detail === undefined ? '' : String(detail).slice(0, 300)); };
const val = (e, n) => String(e.snapshot(n).value);

(async () => {
  const fromFile = process.argv[2] || path.join(__dirname, 'saved-character.pdf');
  if (!fs.existsSync(fromFile)) { console.log('SKIP: no ' + fromFile + ' (run writer.test.js first)'); return; }
  const t0 = Date.now();
  const fromModel = await load(fs.readFileSync(fromFile), PDFLib);
  const from = newEngine(JSON.stringify(fromModel), { fileName: path.basename(fromFile) });
  console.log('opened the sheet to import from', Date.now() - t0, 'ms;', val(from, 'Class and Levels'), '/', val(from, 'Race'));
  let opened = 0;
  const to = newEngine(fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8'), {
    fileName: 'sheet.pdf',
    openDoc: () => { opened++; return from.ctx; },
  });
  const t1 = Date.now();
  to.queueDialog({ name: 'IMPORT FROM PDF DIALOG', steps: [{ set: { fLoc: path.basename(fromFile) } }] });
  to.action('DirectImport(true)');
  console.log('import took', Date.now() - t1, 'ms');
  check('app.openDoc was used', opened === 1, opened);
  for (const n of ['PC Name', 'Class and Levels', 'Race', 'Background', 'Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha', 'HP Max', 'AC', 'Character Level']) {
    check('same ' + n, val(to, n) === val(from, n), val(from, n) + ' → ' + val(to, n));
  }
  // every field with a value in the sheet imported from
  const names = (e) => { const out = []; for (let i = 0; i < e.ctx.numFields; i++) out.push(e.ctx.getNthFieldName(i)); return out; };
  const fromNames = names(from);
  const diffWith = (e, label) => {
    const has = new Set(names(e));
    const diffs = [];
    let compared = 0;
    for (const n of fromNames) {
      const sf = from.snapshot(n);
      if (!sf.exists || sf.value === '' || sf.value === null || sf.value === undefined || sf.value === 'Off') continue;
      compared++;
      if (!has.has(n)) { diffs.push(n + ': missing'); continue; }
      if (String(sf.value) !== String(e.snapshot(n).value)) diffs.push(n + ': ' + JSON.stringify(String(sf.value).slice(0, 60)) + ' → ' + JSON.stringify(String(e.snapshot(n).value).slice(0, 60)));
    }
    if (process.env.VERBOSE) console.log(diffs.join('\n'));
    console.log(label + ': compared', compared, 'fields with a value;', diffs.length, 'differ');
    return diffs;
  };
  diffWith(to, 'imported');
  const pagesOf = (e) => String(e.evalExpr('JSON.stringify([What("Template.extras.SSfront"), What("Template.extras.AScomp"), What("Template.extras.ASnotes"), isTemplVis("ASoverflow")])'));
  check('same extra pages', pagesOf(to) === pagesOf(from), pagesOf(from) + ' → ' + pagesOf(to));

  // the app keeps the import as a saved state and reopens it, as Acrobat does on the next opening (MPMB re-adds its
  // default automation, such as a cantrip's spellcasting ability, only when the sheet opens)
  const st = JSON.parse(JSON.stringify(to.exportState()));
  const reopened = (() => {
    const ctx = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
    const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
    evalGlobal(ENGINE, 'engine.js');
    ctx.__host = { global: ctx, evalGlobal };
    const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
    e.importState(st);
    e.start();
    content.restore(e);
    e.drainChanges();
    e.ctx = ctx;
    return e;
  })();
  const left = diffWith(reopened, 'reopened');
  // what MPMB's import does differently on purpose or by its order (same in Acrobat): MPMB's state fields (rebuilt),
  // the hidden Line.* fields (text without a default, emptied by the reset), attack names as MPMB's weapon list writes
  // them, a cantrip attack set before the class (its ability stays empty: the import's final recalculation keeps the
  // field), limited feature uses (not copied), the spell sheet's slot boxes (MPMB sets them)
  const EXPECTED = /^(Current\w+\.Stringified|Line\.\w+|Attack\.\d+\.Weapon|Attack\.2\.(Mod|To Hit)|Limited Feature Used \d+|P\d+\.SSfront\.SpellSlots\.CheckboxesSet\.lvl\d):/;
  const unexpected = left.filter((d) => !EXPECTED.test(d) || (/^Attack\.\d+\.Weapon:/.test(d) && !/^[^:]+: "(.*)" → "\1"$/i.test(d)));
  check('reopened: same as the sheet imported from', unexpected.length === 0, unexpected.join(' | '));
  check('Adv / Dis boxes not ticked by the import', to.evalExpr('SkillsList.abbreviations.filter(function (s) { return tDoc.getField(s + " Adv").isBoxChecked(0); }).length') === 0);
  check('passive Perception', val(reopened, 'Passive Perception') === val(from, 'Passive Perception'), val(reopened, 'Passive Perception'));
  check('encumbrance speed label (rich text calculation)', val(reopened, 'Display.Speed.Enc') === '10 FT SPEED', val(reopened, 'Display.Speed.Enc'));
  check('companion page and its creature', val(reopened, 'P4.AScomp.Comp.Race') === val(from, 'P4.AScomp.Comp.Race'), val(from, 'P4.AScomp.Comp.Race') + ' → ' + val(reopened, 'P4.AScomp.Comp.Race'));
  if (process.env.PROBE) for (const ex of process.env.PROBE.split(';;')) { console.log('PROBE', ex); console.log('  from:', String(from.evalExpr(ex)).slice(0, 400)); console.log('  to:  ', String(to.evalExpr(ex)).slice(0, 400)); }
  console.log('dialogs:', to.log.dialogs.map((d) => d.name + ':' + (d.title || '') + ':' + d.answered).join(' | ').slice(0, 1500));
  console.log('alerts:', JSON.stringify(to.log.alerts || Object.keys(to.log)).slice(0, 1500));
  console.log('unsupported:', JSON.stringify(to.log.unsupported || []).slice(0, 600));
  console.log('errors to:', to.log.errors.map((x) => x.where + ': ' + x.msg).join('\n').slice(0, 2000));
  console.log('errors from:', from.log.errors.slice(-5).map((x) => x.where + ': ' + x.msg).join('\n').slice(0, 1000));
  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
