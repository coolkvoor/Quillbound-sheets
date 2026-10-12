// Equipment and magic items: MPMB fills in weights and descriptions; the Equipment menu adds gear.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const selftest = require(path.join(SRC, 'selftest.js'));
const content = require(path.join(SRC, 'content.js'));
const ctx = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
evalGlobal(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
ctx.__host = { global: ctx, evalGlobal };
const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
e.start();
content.restore(e);   // what the app does at every open: MPMB rebuilds its dropdowns
for (const [op, f, v] of selftest.steps) e[op](f, v);
e.drainChanges();

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(44), detail === undefined ? '' : String(detail).slice(0, 170)); };
const val = (n) => String(e.snapshot(n).value);
function tap(name, answers) { e.clearQueues(); for (const a of answers || []) e.queueMenu(a); e.press(name, 0); const m = e.takeMenu(); e.clearQueues(); return m; }
const find = (items, re) => { for (const i of items || []) { if (i.items) { const f = find(i.items, re); if (f) return f; } else if (re.test(i.name) || re.test(i.ret)) return i; } return null; };

check('magic item list filled at open', e.snapshot('Extra.Magic Item 1').items.length > 100, e.snapshot('Extra.Magic Item 1').items.length + ' items');

// gear: typing an item and leaving the field (On Blur) sets its weight
e.commit('Adventuring Gear Row 1', 'Rope');
check('gear: Rope gets a weight', Number(val('Adventuring Gear Weight 1')) > 0, 'weight ' + val('Adventuring Gear Weight 1'));
const carried = Number(String(val('Weight Carried')).replace(/[^\d.]/g, ''));
check('weight carried counts it', carried > 0, val('Weight Carried'));

// the Equipment menu: add a pack
let m = tap('Equipment.menu');
const pack = find(m, /explorer/i);
check('Equipment menu offers packs', !!pack, m && m.map((i) => i.name).filter((n) => n !== '-').slice(0, 6).join(', '));
if (pack) {
  m = tap('Equipment.menu', [pack.ret]);
  const rows = []; for (let i = 1; i <= 46; i++) { const r = val('Adventuring Gear Row ' + i); if (r) rows.push(r); }
  check('pack adds its contents', rows.length > 3 && m === null, rows.slice(0, 6).join(', '));
}

// magic items: description and weight from MPMB, attunement
e.commit('Extra.Magic Item 1', 'Bag of Holding');
check('magic item: description filled', /bigger on the inside|lb/i.test(val('Extra.Magic Item Description 1')), val('Extra.Magic Item Description 1').slice(0, 90));
check('magic item: weight', Number(val('Extra.Magic Item Weight 1')) > 0, val('Extra.Magic Item Weight 1'));
e.commit('Extra.Magic Item 2', 'Cloak of Protection');
const att = e.snapshot('Extra.Magic Item Attuned 2');
check('attunement box shown for Cloak of Protection', att.exists && !att.hidden, JSON.stringify({ hidden: att.hidden, checked: att.checked }));
check('Cloak of Protection: +1 AC when attuned', Number(val('AC')) >= 13, 'AC ' + val('AC') + ', attuned ' + att.checked);
m = tap('Extra.Magic Item Button 1');
check('magic item line menu', !!m && m.length > 1, m && m.map((i) => i.name).filter((n) => n !== '-').slice(0, 5).join(', '));

check('no script errors', e.log.errors.length === 0, e.log.errors.map((x) => x.where + ': ' + x.msg + ' ' + x.at).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
