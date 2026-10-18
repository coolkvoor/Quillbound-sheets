// Wild Shapes pages: MPMB's Wild Shape details for a Druid, adding the page, adding and removing shapes with the page's
// Settings menu, typing a beast, skill proficiency, a shape surviving save and restore, and removing the page.
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
const prefixes = () => String(e.evalExpr('What("Template.extras.WSfront")')).split(',').slice(1);
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
const sub = (items, re) => { for (const i of items || []) if (re.test(i.name)) return i.items || []; return []; };

check('no Wild Shapes page in the PDF as distributed', prefixes().length === 0, prefixes().join());
for (const [f, v] of [['Str', '10'], ['Dex', '14'], ['Con', '14'], ['Int', '10'], ['Wis', '16'], ['Cha', '8'], ['Race', 'Human'], ['Class and Levels', 'Druid 2']]) e.commit(f, v);
check('Druid 2: MPMB sets Wild Shape details', val('Wildshapes.Info.KnownForms') === '4 Beast' && /CR 1\/4/.test(val('Wildshapes.Info.Limitations')), val('Wildshapes.Info.KnownForms') + ' / ' + val('Wildshapes.Info.Limitations'));

// the app's addPage: MPMB's DoTemplate as an action, so its calculations restart and the page's details fill in
e.action('DoTemplate("WSfront", "Add")', 'addPage');
const P = prefixes()[0];
check('Wild Shapes page added', prefixes().length === 1, prefixes().join());
check('page shows the Wild Shape details', val(P + 'Wildshapes.Info.KnownForms') === '4 Beast' && val(P + 'Wildshapes.Info.TempHP') === '2' && val(P + 'Wildshapes.Info.Duration') !== '', [val(P + 'Wildshapes.Info.KnownForms'), val(P + 'Wildshapes.Info.TempHP'), val(P + 'Wildshapes.Info.Duration')].join(' / '));

// Settings → Add Wild Shape: the beasts this druid can take
let r = tap(P + 'Wildshapes.Settings');
const low = sub(sub(r.menu, /^Add Wild Shape/), /up to CR 1\/4/);
check('Add Wild Shape: beasts up to CR 1/4', !!find(low, /^add#Wolf#/) && !find(low, /^add#Brown Bear#/));
r = tap(P + 'Wildshapes.Settings', [find(r.menu, /^add#Wolf#/).ret]);
const W = P + 'Wildshape.1.';
check('Wolf in the first shape', val(P + 'Wildshape.Race.1') === 'Wolf', val(P + 'Wildshape.Race.1'));
check('Wolf: Str, AC, CR, speed', val(W + 'Ability.Str.Score') === '14' && val(W + 'AC') === '12' && val(W + 'CR') === '1/4' && /40 ft/.test(val(W + 'Speed')), [val(W + 'Ability.Str.Score'), val(W + 'AC'), val(W + 'CR'), val(W + 'Speed')].join(' / '));
check('Wolf keeps the druid\'s Wisdom save', val(W + 'Ability.Wis.ST.Mod') === '5' && e.snapshot(W + 'Ability.Wis.ST.Prof').checked, val(W + 'Ability.Wis.ST.Mod'));
check('Wolf: temp HP from Wild Shape', val(W + 'HP Temp') === '2', val(W + 'HP Temp'));
check('Wolf: Bite', val(W + 'Attack.1.Weapon') === 'Bite' && val(W + 'Attack.1.To Hit') === '+4' && /1d6\+2/.test(val(W + 'Attack.1.Damage')), val(W + 'Attack.1.To Hit') + ' ' + val(W + 'Attack.1.Damage'));
check('Wolf: traits', /Pack Tactics/.test(val(W + 'Traits')) && (e.snapshot(W + 'Traits').spans || []).length > 1);

// a beast typed into the second shape
e.commit(P + 'Wildshape.Race.2', 'Cat');
check('Cat typed into the second shape', val(P + 'Wildshape.Race.2') === 'Cat' && val(P + 'Wildshape.2.Ability.Dex.Score') !== '', val(P + 'Wildshape.2.Ability.Dex.Score'));

// MPMB's skill name button: not → proficient → expertise → not
const T = P + 'Text.Wildshape.1.Skills.Ath.';
const ath = () => val(T + 'Prof') + ' ' + val(W + 'Skills.Ath');
const seen = [ath()];
for (let i = 0; i < 3; i++) { tap(T + 'Name'); seen.push(ath()); }
// (as in Acrobat, the mark changes but the number doesn't: MPMB only works out the skills when the shape is added)
check('skill dot cycles through expertise and back', seen.join(' | ') === 'nothing 2 | proficient 2 | expertise 2 | nothing 2', seen.join(' | '));

// Settings → Remove Wild Shape
r = tap(P + 'Wildshapes.Settings');
r = tap(P + 'Wildshapes.Settings', [find(r.menu, /^remove#Cat#/).ret]);
check('Cat removed', ['', 'Make a Selection'].indexOf(val(P + 'Wildshape.Race.2')) !== -1 && val(P + 'Wildshape.2.AC') === '' && val(P + 'Wildshape.Race.1') === 'Wolf', val(P + 'Wildshape.Race.2'));

// save and restore: the page and its shape come back
const state = e.exportState();
const e2 = newEngine(state);
const P2 = String(e2.evalExpr('What("Template.extras.WSfront")')).split(',').slice(1);
check('restored: same Wild Shapes page', P2.join() === P, P2.join());
check('restored: Wolf with its AC and Bite', String(e2.snapshot(P + 'Wildshape.Race.1').value) === 'Wolf' && String(e2.snapshot(W + 'AC').value) === '12' && String(e2.snapshot(W + 'Attack.1.Weapon').value) === 'Bite');

// Settings → Remove this page: MPMB asks first; No changes nothing, Yes removes it
r = tap(P + 'Wildshapes.Settings', ['remove page#nothing']);
check('remove page: MPMB asks first', !!r.question && prefixes().length === 1, r.question && r.question.msg.replace(/\s+/g, ' ').slice(0, 90));
r = tap(P + 'Wildshapes.Settings', ['remove page#nothing'], [true]);
check('remove page on Yes', prefixes().length === 0, prefixes().join());

check('no script errors', e.log.errors.length === 0 && e2.log.errors.length === 0, e.log.errors.concat(e2.log.errors).map((x) => x.where + ': ' + x.msg).join(' | '));
console.log(failed ? failed + ' FAILED' : 'All wild shape checks passed');
process.exit(failed ? 1 : 0);
