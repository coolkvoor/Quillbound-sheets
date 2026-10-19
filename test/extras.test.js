// Experience points, ammunition, conditions and exhaustion, notes, the front page's tool line, initiative bonus and
// size: MPMB's own fields and buttons.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const selftest = require(path.join(SRC, 'selftest.js'));
const content = require(path.join(SRC, 'content.js'));
const ctx = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
evalGlobal(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
ctx.__host = { global: ctx, evalGlobal };
const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
e.setStandingAnswer('EXPERIENCE POINTS DIALOG', { steps: [{ end: 'cancel' }] });   // as the worker does
e.start();
content.restore(e);
for (const [op, f, v] of selftest.steps) e[op](f, v);
e.drainChanges();

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(44), detail === undefined ? '' : String(detail).slice(0, 200)); };
const val = (n) => String(e.snapshot(n).value);
const xp = () => JSON.parse(e.evalExpr('JSON.stringify((function () { var lv = Number(What("Character Level")) || 0; var r = getCurrentLevelByXP(lv, What("Total Experience")); return { level: lv, xpLevel: r[0] }; })())'));

// experience: add 2000 XP to a level 3 character (900 XP for level 3, 2700 for 4)
e.commit('Total Experience', '900');
e.commit('Add Experience', '2000');
e.press('Add Experience Button', 0);
const x = xp();
check('Add XP adds to the total', val('Total Experience') === '2900' && val('Add Experience') === '', 'total ' + val('Total Experience'));
check('enough XP for level 4, level left alone', x.xpLevel === 4 && x.level === 3, JSON.stringify(x) + ', next level ' + val('Next level'));
check('MPMB\'s level question answered "not now"', e.log.dialogs.some((d) => d.name === 'EXPERIENCE POINTS DIALOG' && d.answered === 'app'));

// ammunition: arrows, 20, shoot 3, refill
e.commit('AmmoLeftDisplay.Name', 'Arrows');
const max = val('AmmoLeftDisplay.Amount');
check('ammunition: Arrows picked', /arrow/i.test(val('AmmoLeftDisplay.Name')), val('AmmoLeftDisplay.Name') + ', amount ' + max + ', weight ' + val('AmmoLeftDisplay.Weight'));
e.commit('AmmoLeftDisplay.Amount', '20');
e.commit('AmmoLeftDisplay.Amount', '17');
check('ammunition: amount set and spent', val('AmmoLeftDisplay.Amount') === '17', val('AmmoLeftDisplay.Amount'));
// MPMB's Reset button redraws the boxes for the current amount (it doesn't refill)
e.press('AmmoLeftDisplay.Reset', 0);
check('ammunition: Reset keeps the amount', val('AmmoLeftDisplay.Amount') === '17', val('AmmoLeftDisplay.Amount'));

// conditions and exhaustion
e.toggle('Condition.Poisoned');
check('condition: Poisoned', e.snapshot('Condition.Poisoned').checked);
e.commit('Condition.Exhaustion', '2');
check('exhaustion 2: MPMB\'s effect text', /-4|−4|4/.test(val('Condition.Exhaustion Effect')), val('Condition.Exhaustion Effect'));

// notes
e.commit('Extra.Notes', 'Owes the guild 50 gp.');
check('notes kept', val('Extra.Notes') === 'Owes the guild 50 gp.');
// exhaustion takes 2 per level off d20 tests (the checks below): back to none
e.commit('Condition.Exhaustion', '0');
// the tool or custom skill line: MPMB takes the ability from the name (Dex 14: +2, proficiency +2)
e.commit('Too Text', "Thieves' Tools (Dex)");
e.toggle('Too Prof');
check('tool line: Dex + proficiency', val('Too') === '4', val('Too'));
// initiative bonus: added to the Dex modifier
e.commit('Init Bonus', '2');
check('initiative bonus added', val('Initiative bonus') === '4', val('Initiative bonus'));
e.toggle('Reaction Used This Round');
check('reaction used this round', e.snapshot('Reaction Used This Round').checked);
// size: Medium and Small share an export value; the picked item is kept, also through a save and restore
const sizes = e.snapshot('Size Category').items, small = sizes.findIndex((it) => it[0] === 'Small');
e.commit('Size Category', sizes[small][1], small);
check('size: Small picked', e.snapshot('Size Category').index === small, JSON.stringify(e.snapshot('Size Category').index));
// second page: lifestyle cost, other armor, carrying capacity (Str 8: 15 × 8), and the location column with its
// weight per location (MPMB's Equipment menu shows the column)
e.commit('Lifestyle', 'Modest');
check('lifestyle: MPMB\'s daily cost', val('Lifestyle daily cost') === '1 gp', val('Lifestyle daily cost'));
e.toggle('Proficiency Armor Other');
e.commit('Proficiency Armor Other Description', 'Hide armor only');
check('other armor proficiency', e.snapshot('Proficiency Armor Other').checked && val('Proficiency Armor Other Description') === 'Hide armor only');
check('carrying capacity', /^120\b/.test(e.snapshot('Weight Carrying Capacity.Field').display), e.snapshot('Weight Carrying Capacity.Field').display);
check('location column hidden at first', e.snapshot('Adventuring Gear Location.Row 1').hidden);
e.clearQueues(); e.queueMenu('location2'); e.press('Equipment.menu', 0); e.clearQueues();
check('location column shown by the Equipment menu', !e.snapshot('Adventuring Gear Location.Row 1').hidden && !e.snapshot('Adventuring Gear Location.SubtotalName 1').hidden);
e.commit('Adventuring Gear Row 3', 'Torch'); e.commit('Adventuring Gear Amount 3', '5'); e.commit('Adventuring Gear Location.Row 3', 'Backpack');
e.commit('Adventuring Gear Location.SubtotalName 1', 'Backpack');
check('weight per location', val('Adventuring Gear Location.Subtotal 1') === '5', val('Adventuring Gear Location.Subtotal 1'));
// (a second sheet in this realm takes over MPMB's globals: checks on e go above)
const saved = e.exportState();
const e2 = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
e2.importState(JSON.parse(JSON.stringify(saved)));
e2.start();
check('size: Small after save and restore', e2.snapshot('Size Category').index === small, JSON.stringify(e2.snapshot('Size Category').index));
check('tool line after save and restore', String(e2.snapshot('Too').value) === '4' && e2.snapshot('Too Prof').checked, String(e2.snapshot('Too').value));
check('no script errors', e.log.errors.length === 0, e.log.errors.map((y) => y.where + ': ' + y.msg + ' ' + y.at).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
