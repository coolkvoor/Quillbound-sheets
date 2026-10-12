// Classes through MPMB's Class Selection dialog: read its lists, pick a subclass, level up, multiclass, remove a class.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const selftest = require(path.join(SRC, 'selftest.js'));
const content = require(path.join(SRC, 'content.js'));
const classes = require(path.join(SRC, 'classes.js'));
const ctx = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
evalGlobal(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
ctx.__host = { global: ctx, evalGlobal };
const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
e.start();
content.restore(e);
for (const [op, f, v] of selftest.steps) e[op](f, v);
e.drainChanges();

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(44), detail === undefined ? '' : String(detail).slice(0, 200)); };
const val = (n) => String(e.snapshot(n).value);
const time = (fn) => { const t = Date.now(); const r = fn(); return [r, Date.now() - t]; };

let [o, ms] = time(() => classes.options(e));
const wiz = o.classes.filter((c) => c.key === 'wizard')[0];
check('options: classes listed', o.available && o.classes.length >= 12, o.classes.map((c) => c.name).join(', ') + ' (' + ms + ' ms)');
check('options: Wizard subclasses', wiz && wiz.subclasses.length > 0 && wiz.subclassLevel === 3, wiz && wiz.subclasses.join(', '));
check('options: current row Wizard 3', o.rows.length === 1 && o.rows[0].cls === wiz.name && o.rows[0].level === 3, JSON.stringify(o.rows));
check('options: nothing changed', val('Class and Levels') === 'Wizard 3' || /wizard/i.test(val('Class and Levels')), val('Class and Levels'));

// a subclass
const sub = wiz.subclasses[0];
let [r, ms2] = time(() => classes.apply(e, [{ cls: wiz.name, sub, level: 3 }]));
check('subclass: ' + sub, new RegExp(sub.split(' ').pop(), 'i').test(val('Class and Levels')) && r.errors.length === 0, val('Class and Levels') + ' in ' + ms2 + ' ms; ' + r.dialogs.join(', '));
check('subclass features added', new RegExp(sub.split(' ').pop(), 'i').test(val('Class Features')), val('Class Features').split('\r').filter((l) => /◆/.test(l)).slice(-2).join(' / '));

// level up to 4
classes.apply(e, [{ cls: wiz.name, sub, level: 4 }]);
check('level up: Wizard 4', val('Character Level') === '4', 'level ' + val('Character Level') + ', ' + val('Class and Levels'));

// multiclass: + Fighter 1
const fighter = o.classes.filter((c) => c.key === 'fighter')[0];
[r] = time(() => classes.apply(e, [{ cls: wiz.name, sub, level: 4 }, { cls: fighter.name, sub: '', level: 1 }]));
check('multiclass: Wizard 4 + Fighter 1', val('Character Level') === '5' && /fighter/i.test(val('Class and Levels')), val('Class and Levels') + ' / level ' + val('Character Level') + ' ' + r.errors.join(' | '));
o = classes.options(e);
check('options read the two rows back', o.rows.length === 2 && o.rows[1].cls === fighter.name && o.rows[0].sub === sub, JSON.stringify(o.rows.map((x) => [x.cls, x.sub, x.level])));

// remove the Fighter again
classes.apply(e, [{ cls: wiz.name, sub, level: 4 }]);
check('remove a class', val('Character Level') === '4' && !/fighter/i.test(val('Class and Levels')), val('Class and Levels'));
check('no script errors', e.log.errors.length === 0, e.log.errors.map((x) => x.where + ': ' + x.msg + ' ' + x.at).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
