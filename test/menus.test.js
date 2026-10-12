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

check('no script errors', e.log.errors.length === 0, e.log.errors.map((x) => x.where + ': ' + x.msg + ' ' + x.at).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
