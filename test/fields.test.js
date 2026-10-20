// Smaller sheet parts the app shows: Notes pages (MPMB's Options menu: lines, add and remove a page), the overflow
// page's "more proficiencies", the modifier area's switches (Jack of All Trades, Remarkable Athlete, Proficiency
// dice, Players Make All Rolls), armour weight, an attack's damage die, and the companion's initiative bonus and
// modifier fields. Then save and restore.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const selftest = require(path.join(SRC, 'selftest.js'));
const content = require(path.join(SRC, 'content.js'));
const MODEL = fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8');
const ENGINE = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
function newEngine(state) {
  const ctx = vm.createContext({ __modelJSON: MODEL });
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
const find = (items, re) => { for (const i of items || []) { if (i.items) { const f = find(i.items, re); if (f) return f; } else if (re.test(i.ret) || re.test(i.name)) return i; } return null; };
function tap(e, where, ret, yes) {
  e.clearQueues();
  if (ret) e.queueMenu(ret);
  if (yes !== undefined) e.queueAnswer(yes);
  if (Array.isArray(where)) e.runBookmark(where); else e.press(where, 0);
  const m = e.takeMenu(); e.clearQueues(); return m;
}
const val = (e, n) => String(e.snapshot(n).value);
const shown = (e, n) => { const s = e.snapshot(n); return s.exists && !s.hidden; };
const notesPages = (e) => String(e.evalExpr('What("Template.extras.ASnotes")')).split(',').slice(1);

const e = newEngine();
for (const [op, f, v] of selftest.steps) e[op](f, v);
e.drainChanges();

// Notes pages
const N1 = notesPages(e)[0];
check('the PDF has one notes page', notesPages(e).length === 1 && shown(e, N1 + 'Notes.Left'), notesPages(e).join(' '));
let m = tap(e, N1 + 'Notes.Options');
check('notes Options menu', !!find(m, /^add page$/) && !!find(m, /^remove page$/) && !!find(m, /whiteout\.notes\.left/i), m && m.map((i) => i.name).filter((x) => x !== '-').join(' | '));
const white = () => e.snapshot(N1 + 'Whiteout.Notes.Left').hidden;
const w0 = white();
tap(e, N1 + 'Notes.Options', find(m, /whiteout\.notes\.left/i).ret);
check('Left column lines: toggled', white() !== w0, w0 + ' → ' + white());
tap(e, N1 + 'Notes.Options', 'add page');
const two = notesPages(e);
check('Add extra notes page', two.length === 2 && shown(e, two[1] + 'Notes.Left'), two.join(' '));
e.commit(two[1] + 'Notes.Right', 'Second page notes');
e.commit(N1 + 'Notes.Left', 'First page notes');
tap(e, two[1] + 'Notes.Options', 'remove page', true);
check('Remove this notes page', notesPages(e).length === 1 && val(e, N1 + 'Notes.Left') === 'First page notes', notesPages(e).join(' '));
tap(e, N1 + 'Notes.Options', 'add page');

// more proficiencies: languages beyond the sheet's lines go to the overflow field
const langs = ['Common', 'Elvish', 'Draconic', 'Dwarvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Infernal', 'Sylvan', 'Primordial', 'Undercommon'];
for (const l of langs) e.evalExpr('AddLanguage(' + JSON.stringify(l) + ', "test")');
e.evalExpr('1');
check('languages that don\'t fit go to MoreProficiencies', val(e, 'MoreProficiencies') !== '', val(e, 'MoreProficiencies'));

// modifiers: shown with Functions → Modifiers
e.runBookmark(['Functions', 'Modifiers']);
check('switches and weights shown with the modifiers', ['Jack of All Trades', 'Remarkable Athlete', 'Proficiency Bonus Dice', 'BlueText.Players Make All Rolls', 'AC Armor Weight', 'BlueText.Attack.1.Damage Die'].every((n) => shown(e, n)));
const ath = Number(val(e, 'Ath'));
e.toggle('Remarkable Athlete');
check('Remarkable Athlete adds half proficiency to Athletics', Number(val(e, 'Ath')) === ath + 1, ath + ' → ' + val(e, 'Ath'));
e.toggle('Remarkable Athlete');
const his = Number(val(e, 'His'));
e.toggle('Jack of All Trades');
check('Jack of All Trades', Number(val(e, 'His')) >= his, his + ' → ' + val(e, 'His'));
e.toggle('Jack of All Trades');
// MPMB counts armour only when the Weight dialog says so (by default coins and the gear columns)
e.clearQueues(); e.queueDialog({ name: 'CARRIED WEIGHT DIALOG', steps: [{ set: { cArm: true } }] }); e.runBookmark(['Functions', 'Weight']); e.clearQueues();
const carried = Number(val(e, 'Weight Carried')) || 0;
e.commit('AC Armor Weight', '20');
check('armour weight counts (Weight: Armor on)', (Number(val(e, 'Weight Carried')) || 0) === carried + 20, carried + ' → ' + val(e, 'Weight Carried'));
const dmg = val(e, 'Attack.1.Damage');
e.commit('BlueText.Attack.1.Damage Die', '2d6');
check('damage die changes the attack\'s damage', /2d6/.test(val(e, 'Attack.1.Damage')) || val(e, 'Attack.1.Damage') !== dmg, dmg + ' → ' + val(e, 'Attack.1.Damage'));

// companion: initiative bonus and a modifier
const C = 'P4.AScomp.';
e.commit(C + 'Comp.Race', 'Wolf');
const init = Number(val(e, C + 'Comp.Use.Combat.Init.Mod'));
e.commit(C + 'Comp.Use.Combat.Init.Bonus', '2');
check('companion initiative bonus', Number(val(e, C + 'Comp.Use.Combat.Init.Mod')) === init + 2, init + ' → ' + val(e, C + 'Comp.Use.Combat.Init.Mod'));
check('companion modifiers shown', shown(e, C + 'BlueText.Comp.Use.Skills.Acr.Bonus'));
const ste = Number(val(e, C + 'Comp.Use.Skills.Ste.Mod'));
e.commit(C + 'BlueText.Comp.Use.Skills.Ste.Bonus', '3');
check('companion Stealth modifier', Number(val(e, C + 'Comp.Use.Skills.Ste.Mod')) === ste + 3, ste + ' → ' + val(e, C + 'Comp.Use.Skills.Ste.Mod'));
// the 7th ability score (Set Pages Layout → 1st page options → Ability Scores → Honor)
m = tap(e, ['Functions', 'Set Pages Layout']);
const honor = find(m, /scores#honor/);
check('Pages menu offers Honor', !!honor, honor && honor.ret);
tap(e, ['Functions', 'Set Pages Layout'], honor.ret);
e.commit('HoS', '14');
e.commit('HoS ST Bonus', '1');
check('Honor shown with its modifier and save', shown(e, 'HoS') && val(e, 'HoSRememberState') === 'Honor' && val(e, 'HoS Mod') === '2' && Number(val(e, 'HoS ST Mod')) === 3,
  [shown(e, 'HoS'), val(e, 'HoSRememberState'), val(e, 'HoS Mod'), val(e, 'HoS ST Mod')].join(' '));
check('no errors', e.log.errors.filter((x) => !/countDecimals/.test(x.msg)).length === 0, JSON.stringify(e.log.errors.slice(-2)));

// save and restore
const r = newEngine(e.exportState());
const np = notesPages(r);
check('restore: two notes pages and their text', np.length === 2 && val(r, np[0] + 'Notes.Left') === 'First page notes', np.join(' '));
check('restore: modifiers, weights, companion', shown(r, 'AC Armor Weight') && val(r, 'AC Armor Weight') === '20' && val(r, C + 'Comp.Use.Combat.Init.Bonus') === '2'
  && Number(val(r, C + 'Comp.Use.Skills.Ste.Mod')) === ste + 3 && val(r, 'MoreProficiencies') === val(e, 'MoreProficiencies'));
check('restore: Honor', shown(r, 'HoS') && val(r, 'HoS') === '14' && val(r, 'HoS ST Mod') === val(e, 'HoS ST Mod'), [shown(r, 'HoS'), val(r, 'HoS'), val(r, 'HoS ST Mod')].join(' '));

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
