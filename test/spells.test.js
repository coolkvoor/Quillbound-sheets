// Builds the self-test Wizard 3, chooses spells through MPMB's spell dialogs, generates the spell sheet and reads it back.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const selftest = require(path.join(SRC, 'selftest.js'));
const spells = require(path.join(SRC, 'spells.js'));
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
const time = (fn) => { const t = Date.now(); const r = fn(); return [r, Date.now() - t]; };

const before = {};
for (const n of e.fieldNames()) before[n] = e.getField(n).valueAsString;
const [opt, optMs] = time(() => spells.options(e));
const wiz = opt.casters.filter((c) => c.key === 'wizard')[0];
check('options: the Wizard is a caster', !!wiz, opt.casters.map((c) => c.key).join(', ') + ' in ' + optMs + ' ms');
check('options: 3 cantrips to choose', wiz && wiz.cantrips && wiz.cantrips.count === 3 && wiz.cantrips.list.some((s) => s.key === 'fire bolt'), wiz && wiz.cantrips && wiz.cantrips.list.map((s) => s.name).join(', '));
check('options: spellbook list with levels', wiz && wiz.spells && wiz.spells.book && wiz.spells.list.length > 20 && opt.spells['magic missile'] && opt.spells['magic missile'].level === 1, wiz && wiz.spells && wiz.spells.list.length + ' spells');
const changed = e.drainChanges().filter((n) => !/Stringified/.test(n) && e.getField(n).valueAsString !== before[n]);
check('options: no field values changed', changed.length === 0 && e.log.errors.length === 0, changed.join(', '));
check('options: spellbook caster prepares from the book', wiz && wiz.prepared && wiz.prepared.fromBook && wiz.prepared.count === 6, wiz && wiz.prepared && wiz.prepared.count);

const book = ['magic missile', 'shield', 'sleep', 'detect magic', 'mage armor', 'burning hands', 'find familiar', 'thunderwave'];
const prep = ['magic missile', 'shield', 'sleep', 'mage armor', 'detect magic', 'burning hands'];
let [r, ms] = time(() => spells.choose(e, { wizard: { cantrips: ['fire bolt', 'mage hand', 'light'], spells: book, prepared: prep, show: 3 } }));
check('choose: spell sheet generated', r.sheet.pages >= 1 && r.errors.length === 0, r.sheet.pages + ' page(s) in ' + ms + ' ms ' + r.errors.join(' | '));
const names = r.sheet.rows.map((x) => x.key);
check('sheet: chosen cantrips listed', ['fire bolt', 'mage hand', 'light'].every((k) => names.indexOf(k) !== -1), r.sheet.rows.filter((x) => x.level === 0).map((x) => x.name).join(', '));
check('sheet: prepared spells listed', prep.every((k) => names.indexOf(k) !== -1), r.sheet.rows.filter((x) => x.level > 0).map((x) => x.name).join(', '));
check('sheet: only prepared spells (not Thunderwave)', names.indexOf('thunderwave') === -1);
const head = r.sheet.casters.filter((c) => c.key === 'wizard')[0];
check('sheet: Wizard DC 13, attack +5', head && head.dc === '13' && /\+?5/.test(head.attack), head && JSON.stringify(head));
const mm = r.sheet.rows.filter((x) => x.key === 'magic missile')[0];
check('sheet: row details from MPMB', mm && mm.range && mm.time && mm.description, mm && [mm.name, mm.time, mm.range, mm.components, mm.duration, mm.description].join(' · '));

// a second generation replaces the first
[r] = time(() => spells.choose(e, { wizard: { cantrips: ['fire bolt', 'mage hand', 'ray of frost'], spells: book, prepared: prep.slice(0, 5).concat(['thunderwave']), show: 3 } }));
const keys2 = r.sheet.rows.map((x) => x.key);
check('regenerate: new picks replace the old', keys2.indexOf('ray of frost') !== -1 && keys2.indexOf('light') === -1 && keys2.indexOf('thunderwave') !== -1 && r.sheet.pages === 1, r.sheet.pages + ' page(s); ' + r.alerts.map((a) => a.title).join(', '));
// the spellbook list (show 1) has a prepared box per spell: MPMB's row button ticks it
[r] = time(() => spells.choose(e, { wizard: { show: 1 } }));
const row = r.sheet.rows.filter((x) => x.key === 'thunderwave')[0];
check('spellbook list: Thunderwave can be prepared', row && row.toggles === 'prepared' && !row.on && !!row.button, row && JSON.stringify({ first: row.first, toggles: row.toggles, on: row.on }));
r = spells.tapRow(e, row.button);
const row2 = r.sheet.rows.filter((x) => x.key === 'thunderwave')[0];
check('tap: Thunderwave marked prepared', row2 && row2.on && !r.menu, row2 && row2.first);
r = spells.tapRow(e, row.button);
check('tap again: not prepared', !r.sheet.rows.filter((x) => x.key === 'thunderwave')[0].on);
const d = spells.details(e, 'magic missile');
check('details: full description', d && d.text.length > 80, d && d.text.slice(0, 90));
[r] = time(() => spells.remove(e));
check('remove: spell sheet gone', r.sheet.pages === 0 && r.sheet.rows.length === 0, r.alerts.map((a) => a.title).join(', '));
// a caster that prepares from its whole class list (Cleric): the prepared picks make a prepared-only list,
// even when the app sends an empty spellbook along
{
  const ctx2 = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
  const ev2 = (code, name) => vm.runInContext(code, ctx2, { filename: name || 'eval' });
  ev2(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
  ctx2.__host = { global: ctx2, evalGlobal: ev2 };
  const c = ev2('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  c.start();
  c.commit('Wis', '16'); c.commit('Class and Levels', 'Cleric 3');
  const co = spells.options(c).casters.filter((x) => x.key === 'cleric')[0];
  check('Cleric: prepares from the class list', co && !co.spells && co.prepared && co.prepared.count === 6 && co.prepared.list.length > 10, co && JSON.stringify({ spells: co.spells, prepared: co.prepared && co.prepared.count }));
  const prep = ['bless', 'cure wounds', 'healing word', 'shield of faith', 'aid', 'spiritual weapon'];
  const cr = spells.choose(c, { cleric: { cantrips: ['guidance', 'sacred flame', 'spare the dying'], spells: [], prepared: prep, show: 3 } });
  const ck = cr.sheet.rows.map((x) => x.key);
  check('Cleric: prepared spells on the list', prep.every((k) => ck.indexOf(k) !== -1) && ck.length === 9, ck.join(', '));
  check('Cleric: no script errors', c.log.errors.length === 0, c.log.errors.map((x) => x.where + ': ' + x.msg).join(' | '));
}
check('no script errors', e.log.errors.length === 0, e.log.errors.map((x) => x.where + ': ' + x.msg + ' ' + x.at).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
