// MPMB's pop-up menus: the app runs a button once to get its menu, then again with the user's choice.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const selftest = require(path.join(SRC, 'selftest.js'));
const ctx = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
evalGlobal(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
ctx.__host = { global: ctx, evalGlobal };
const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
e.start();
for (const [op, f, v] of selftest.steps) e[op](f, v);
e.drainChanges();

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(44), detail === undefined ? '' : String(detail).slice(0, 170)); };
function tap(name, answers) { e.clearQueues(); for (const a of answers || []) e.queueMenu(a); e.press(name, 0); const m = e.takeMenu(); e.clearQueues(); return m; }
const find = (items, re) => { for (const i of items || []) { if (i.items) { const f = find(i.items, re); if (f) return f; } else if (re.test(i.name) || re.test(i.ret)) return i; } return null; };
const val = (n) => String(e.snapshot(n).value);

// species options: the Elf lineage
let m = tap('Race Features Menu');
const high = find(m, /^High Elf/);
check('species menu lists the Elf lineages', !!high, m && m.map((i) => i.name.split('\t')[0]).join(', '));
check('first run changes nothing', e.drainChanges().length === 0);
m = tap('Race Features Menu', [high.ret]);
check('choosing High Elf: no further menu', m === null);
check('High Elf traits filled in', /High Elf|Prestidigitation/i.test(val('Racial Traits')), val('Racial Traits').split('\r').slice(0, 2).join(' / '));
check('species line shows the lineage', /high/i.test(val('Race')), val('Race'));

// HP: Set Max HP → fixed values
m = tap('Buttons.HP Max');
const fixed = find(m, /^hp#change#\d+#fixed/);
tap('Buttons.HP Max', [fixed.ret]);
check('Set Max HP to fixed values', val('HP Max') === fixed.ret.split('#')[2], 'HP Max ' + val('HP Max'));

// a menu answer that isn't in the menu is ignored
tap('Buttons.HP Max', ['hp#change#999#fixed#']);
check('unknown menu answer is ignored', val('HP Max') !== '999', 'HP Max ' + val('HP Max'));

// rests: Arcane Recovery used once, then a long rest resets it
e.commit('Limited Feature Used 1', '1');
tap('LR');
check('Long rest resets limited features', val('Limited Feature Used 1') === '', JSON.stringify(val('Limited Feature Used 1')));

// a line menu: delete the first attack, the second one moves up
m = tap('Attack.Button.1');
const del = find(m, /^Delete/i);
check('attack line menu has Delete', !!del, m && m.map((i) => i.name).filter((n) => n !== '-').join(', '));
tap('Attack.Button.1', [del.ret]);
check('Delete: Fire Bolt moves up to line 1', /fire bolt/i.test(val('Attack.1.Weapon Selection')) && val('Attack.2.Weapon Selection') === '', val('Attack.1.Weapon Selection') + ' / ' + JSON.stringify(val('Attack.2.Weapon Selection')));

// a feat from MPMB's list, then its line menu
e.commit('Feat Name 1', 'Alert');
check('feat chosen from the list', /alert/i.test(val('Feat Name 1')) && val('Feat Description 1').length > 10, val('Feat Description 1').slice(0, 80));
m = tap('Feat Button 1');
check('feat line menu', !!m && m.length > 1, m && m.map((i) => i.name).filter((n) => n !== '-').slice(0, 6).join(', '));

// a bookmark with a menu: Functions > Spells Options
function tapBookmark(path, answers) { e.clearQueues(); for (const a of answers || []) e.queueMenu(a); e.runBookmark(path); const mm = e.takeMenu(); e.clearQueues(); return mm; }
m = tapBookmark(['Functions', 'Spells Options']);
check('Spells Options menu', !!find(m, /generate/i), m && m.map((i) => i.name).filter((n) => n !== '-').slice(0, 6).join(', '));

// Skill options: MPMB's text dialog, and its modifier ("blue text") fields
const d0 = e.logSeq;
tap('SkillsClick', ['skills#dialog']);
const textDlg = e.log.dialogs.filter((d) => d.seq > d0 && d.text)[0];
check('skill options dialog: text for the app', !!textDlg && textDlg.text.length > 20, textDlg && (textDlg.title + ': ' + textDlg.text.replace(/\s+/g, ' ').slice(0, 90)));
check('modifier fields hidden at first', e.snapshot('Arc Bonus').hidden);
m = tap('SkillsClick');
const showMods = find(m, /skills#bluetextfields/);
tap('SkillsClick', [showMods.ret]);
check('"Show fields to modify…" shows them', !e.snapshot('Arc Bonus').hidden && !e.snapshot('BlueText.Attack.1.To Hit Bonus').hidden, showMods.name);
e.commit('Arc Bonus', '2');
check('Arcana +2 modifier counts', val('Arc') === '5', 'Arcana ' + val('Arc'));
m = tap('SkillsClick');
check('the menu marks the option as on', find(m, /skills#bluetextfields/).marked, JSON.stringify(find(m, /skills#bluetextfields/)));

// pages (Functions → Set Pages Layout), and MPMB's yes/no questions: asked before anything changes, as the worker's tap does
function tapAsk(path, answers, yes) {
  e.clearQueues(); for (const a of answers || []) e.queueMenu(a); for (const y of yes || []) e.queueAnswer(y);
  e.askQuestions(true); try { e.runBookmark(path); } finally { e.askQuestions(false); }
  const r = { menu: e.takeMenu(), question: e.takeQuestion() }; e.clearQueues(); return r;
}
const comps = () => String(e.snapshot('Template.extras.AScomp').value).split(',').length - 1;
const LAYOUT = ['Functions', 'Set Pages Layout'];
let r = tapAsk(LAYOUT);
check('Set Pages Layout menu lists the pages', !!find(r.menu, /^template#WSfront#add/) && !!find(r.menu, /^template#AScomp#remove/));
const pages0 = e.evalExpr('tDoc.numPages');
tapAsk(LAYOUT, ['template#WSfront#add']);
check('adding a Wild Shapes page', e.evalExpr('tDoc.numPages') === pages0 + 1 && /WSfront/.test(String(e.snapshot('Template.extras.WSfront').value)), e.snapshot('Template.extras.WSfront').value);
const c0 = comps();
r = tapAsk(LAYOUT, ['template#AScomp#remove']);
check('removing a Companion page asks first', !!r.question && /can't be undone/i.test(r.question.msg), r.question && r.question.msg.slice(0, 80));
check('... and nothing is removed before the answer', comps() === c0, comps() + ' companion pages');
r = tapAsk(LAYOUT, ['template#AScomp#remove'], [true]);
check('... Yes removes it', !r.question && comps() === c0 - 1, comps() + ' companion pages');

// clearing out the Notes pages (the app's recovery for MPMB's AddToNotes loop): MPMB's remove-all, then a new page works
e.evalExpr('DoTemplate("ASnotes", "RemoveAll", false, true)');
check('all Notes pages removed', e.snapshot('Template.extras.ASnotes').value === '', JSON.stringify(e.snapshot('Template.extras.ASnotes').value));
e.evalExpr('DoTemplate("ASnotes", "Add")');
check('... and a new Notes page can be added', /ASnotes/.test(String(e.snapshot('Template.extras.ASnotes').value)), e.snapshot('Template.extras.ASnotes').value);

check('no script errors', e.log.errors.length === 0, e.log.errors.map((x) => x.where + ': ' + x.msg + ' ' + x.at).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
