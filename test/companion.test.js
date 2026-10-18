// Companion pages: picking a creature, skill proficiency, long rest, MPMB's familiar menu, adding and removing
// companion pages (with the question MPMB asks first), and a companion surviving save and restore.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const content = require(path.join(SRC, 'content.js'));
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
const val = (n) => String(e.snapshot(n).value);
const prefixes = () => String(e.evalExpr('What("Template.extras.AScomp")')).split(',').slice(1);
// the worker's tap: questions answered No (and kept) unless an answer is queued
function tap(name, answers, yes) {
  e.clearQueues(); for (const a of answers || []) e.queueMenu(a); for (const y of yes || []) e.queueAnswer(y);
  e.askQuestions(true);
  try { e.press(name, 0); } finally { e.askQuestions(false); }
  const r = { menu: e.takeMenu(), question: e.takeQuestion() };
  e.clearQueues();
  return r;
}
const find = (items, re) => { for (const i of items || []) { if (i.items) { const f = find(i.items, re); if (f) return f; } else if (re.test(i.ret)) return i; } return null; };

check('one companion page in the PDF as distributed', prefixes().join() === 'P4.AScomp.', prefixes().join());
const P = 'P4.AScomp.', U = P + 'Comp.Use.';

// a creature from MPMB's list fills the page
e.commit(P + 'Comp.Race', 'Wolf');
check('Wolf: abilities', val(U + 'Ability.Str.Score') === '14' && val(U + 'Ability.Dex.Mod') === '2', 'Str ' + val(U + 'Ability.Str.Score') + ', Dex mod ' + val(U + 'Ability.Dex.Mod'));
check('Wolf: AC, speed, HP', e.snapshot(U + 'AC').display === '12' && /40 ft/.test(val(U + 'Speed')) && val(U + 'HP.Max') === '11', [e.snapshot(U + 'AC').display, val(U + 'Speed'), val(U + 'HP.Max')].join(' / '));
check('Wolf: Bite attack worked out', val(U + 'Attack.1.Weapon Selection') === 'Bite' && val(U + 'Attack.1.To Hit') === '+4' && /1d6\+2/.test(val(U + 'Attack.1.Damage')), val(U + 'Attack.1.To Hit') + ' ' + val(U + 'Attack.1.Damage'));
check('Wolf: Pack Tactics trait', /Pack Tactics/.test(val(U + 'Traits')));
check('Wolf: Perception expertise', val(P + 'Text.Comp.Use.Skills.Perc.Prof') === 'expertise' && val(U + 'Skills.Perc.Mod') === '5', val(U + 'Skills.Perc.Mod'));

// MPMB's skill name button: not → proficient → expertise → not
const ath = () => val(P + 'Text.Comp.Use.Skills.Ath.Prof') + ' ' + val(U + 'Skills.Ath.Mod');
const seen = [ath()];
for (let i = 0; i < 3; i++) { tap(P + 'Text.Comp.Use.Skills.Ath.Name'); seen.push(ath()); }
check('skill dot cycles through expertise and back', seen.join(' | ') === 'nothing 2 | proficient 4 | expertise 6 | nothing 2', seen.join(' | '));

// long rest (MPMB's heal button)
e.commit(U + 'HP.Current', '3'); e.commit(U + 'HD.Used', '2'); e.toggle(U + 'DeathSave.Fail.1');
tap(P + 'Comp.Heal');
check('long rest: HP, death saves, hit dice', val(U + 'HP.Current') === '' && !e.snapshot(U + 'DeathSave.Fail.1').checked && val(U + 'HD.Used') === '1', 'HP "' + val(U + 'HP.Current') + '", HD used ' + val(U + 'HD.Used'));

// the Options menu: a familiar (Find Familiar) on this page
let r = tap(P + 'Companion.Options');
const cat = find(r.menu, /^companion#add_comp#familiar#Cat#/);
check('Options menu offers familiars', !!cat);
r = tap(P + 'Companion.Options', [cat.ret]);
if (r.question) r = tap(P + 'Companion.Options', [cat.ret], [true]);
check('Cat familiar on the page', /cat/i.test(val(P + 'Comp.Race')) && val(P + 'Comp.Type') === 'Familiar', val(P + 'Comp.Race') + ' / ' + val(P + 'Comp.Type'));

// a second page, with the app's addPage (MPMB's DoTemplate)
e.evalExpr('DoTemplate("AScomp", "Add")');
const two = prefixes();
check('second companion page added', two.length === 2, two.join());
const Q = two[1];
e.commit(Q + 'Comp.Race', 'Riding Horse');
check('second page has its own creature', /horse/i.test(val(Q + 'Comp.Race')) && /cat/i.test(val(P + 'Comp.Race')), val(Q + 'Comp.Race') + ' / ' + val(P + 'Comp.Race'));

// save and restore: both companions come back on their pages
const state = e.exportState();
const e2 = newEngine(state);
const pre2 = String(e2.evalExpr('What("Template.extras.AScomp")')).split(',').slice(1);
check('restored: same companion pages', pre2.join() === two.join(), pre2.join());
check('restored: creatures and HP', /cat/i.test(String(e2.snapshot(P + 'Comp.Race').value)) && /horse/i.test(String(e2.snapshot(Q + 'Comp.Race').value)) && String(e2.snapshot(Q + 'Comp.Use.HP.Max').value) === val(Q + 'Comp.Use.HP.Max'), String(e2.snapshot(Q + 'Comp.Use.HP.Max').value));

// removing a page: MPMB asks first; No changes nothing, Yes removes it
r = tap(Q + 'Companion.Options', ['companion#remove_page']);
check('remove page: MPMB asks first', !!r.question && prefixes().length === 2, r.question && r.question.msg.replace(/\s+/g, ' ').slice(0, 90));
r = tap(Q + 'Companion.Options', ['companion#remove_page'], [true]);
check('remove page on Yes', prefixes().join() === 'P4.AScomp.', prefixes().join());

check('no script errors', e.log.errors.length === 0, e.log.errors.map((x) => x.where + ': ' + x.msg).join(' | '));
console.log(failed ? failed + ' FAILED' : 'All companion checks passed');
process.exit(failed ? 1 : 0);
