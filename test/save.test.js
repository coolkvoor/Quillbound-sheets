// Saving: build a character (species option, spells, gear, a feat, a spent use), export the engine's state,
// put it into a fresh copy of the sheet before MPMB starts, and check the character is all there.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const selftest = require(path.join(SRC, 'selftest.js'));
const content = require(path.join(SRC, 'content.js'));
const spells = require(path.join(SRC, 'spells.js'));
const modelJSON = fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8');
const engineSrc = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
function newEngine(state) {
  const ctx = vm.createContext({ __modelJSON: modelJSON });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(engineSrc, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const engine = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  if (state) engine.importState(JSON.parse(JSON.stringify(state)));
  engine.start();
  content.restore(engine);
  engine.drainChanges();
  return engine;
}

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(44), detail === undefined ? '' : String(detail).slice(0, 170)); };

const e = newEngine(null);
for (const [op, f, v] of selftest.steps) e[op](f, v);
e.commit('PC Name', 'Ilvara');
e.clearQueues(); e.queueMenu('elf#high'); e.press('Race Features Menu', 0); e.clearQueues();
e.commit('Feat Name 1', 'Alert');
e.commit('Adventuring Gear Row 1', 'Rope');
e.commit('Extra.Magic Item 1', 'Cloak of Protection');
e.commit('Limited Feature Used 1', '1');
e.commit('HP Max', '17'); e.commit('HP Current', '12');
spells.choose(e, { wizard: { cantrips: ['fire bolt', 'mage hand', 'light'], spells: ['magic missile', 'shield', 'sleep', 'detect magic', 'mage armor', 'burning hands'], prepared: ['magic missile', 'shield', 'sleep', 'mage armor', 'detect magic', 'burning hands'], show: 3 } });
const want = {};
const KEYS = ['PC Name', 'Race', 'Racial Traits', 'Class and Levels', 'Character Level', 'Int Mod', 'Int ST Mod', 'Arc', 'AC', 'HP Max', 'HP Current', 'Limited Feature 1', 'Limited Feature Used 1', 'Feat Name 1', 'Feat Description 1', 'Adventuring Gear Row 1', 'Adventuring Gear Weight 1', 'Extra.Magic Item 1', 'Extra.Magic Item Description 1', 'Attack.2.To Hit', 'Class Features'];
for (const k of KEYS) want[k] = String(e.snapshot(k).value);
const sheet1 = spells.sheet(e);

let t = Date.now();
const st = e.exportState();
const json = JSON.stringify(st);
check('export: state as differences', Object.keys(st.fields).length > 50 && Object.keys(st.fields).length < 4000, Object.keys(st.fields).length + ' fields, ' + (json.length / 1024).toFixed(0) + ' KB, ' + st.pageOps.length + ' page changes, ' + (Date.now() - t) + ' ms');

t = Date.now();
const e2 = newEngine(st);
check('restore: MPMB starts without errors', e2.log.errors.length === 0, 'start + restore ' + (Date.now() - t) + ' ms ' + e2.log.errors.map((x) => x.where + ': ' + x.msg).join(' | '));
const diffs = KEYS.filter((k) => String(e2.snapshot(k).value) !== want[k]);
check('restore: the character is all there', diffs.length === 0, diffs.map((k) => k + ': ' + JSON.stringify(String(e2.snapshot(k).value).slice(0, 40)) + ' (was ' + JSON.stringify(want[k].slice(0, 40)) + ')').join(' | ') || KEYS.length + ' fields match');
const sheet2 = spells.sheet(e2);
check('restore: the spell list is back', sheet2.rows.length === sheet1.rows.length && sheet2.rows.map((r) => r.key).join() === sheet1.rows.map((r) => r.key).join(), sheet2.rows.length + ' rows on ' + sheet2.pages + ' page(s)');
const opt = spells.options(e2);
const wiz = opt.casters.filter((c) => c.key === 'wizard')[0];
check('restore: MPMB still knows the spell picks', wiz && wiz.cantrips.chosen.length === 3 && wiz.spells.chosen.length === 6, wiz && JSON.stringify(wiz.cantrips.chosen));

// it keeps working: a change after restoring, saved and restored again
e2.commit('Class and Levels', 'Wizard 4');
check('after restore: levelling up still works', String(e2.snapshot('Character Level').value) === '4', 'level ' + e2.snapshot('Character Level').value);
const e3 = newEngine(e2.exportState());
check('save again, restore again', String(e3.snapshot('Character Level').value) === '4' && String(e3.snapshot('PC Name').value) === 'Ilvara' && spells.sheet(e3).rows.length === sheet1.rows.length && e3.log.errors.length === 0);
check('no script errors', e.log.errors.length + e2.log.errors.length + e3.log.errors.length === 0, e.log.errors.concat(e2.log.errors, e3.log.errors).map((x) => x.where + ': ' + x.msg + ' ' + x.at).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
