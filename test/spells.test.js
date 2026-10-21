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
// a spellbook of more than 20 spells: MPMB keeps the rest in its extra spellbook (selectSpSB). Saving again with
// the picks read back must keep all of them, and the prepared spells among them (before the fix: 16 prepared → 10)
{
  const ctx3 = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
  const ev3 = (code, name) => vm.runInContext(code, ctx3, { filename: name || 'eval' });
  ev3(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
  ctx3.__host = { global: ctx3, evalGlobal: ev3 };
  const w = ev3('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  w.start();
  w.commit('Int', '18'); w.commit('Class and Levels', 'Wizard (Evoker) 12');
  let o3 = spells.options(w); let wz = o3.casters.filter((x) => x.key === 'wizard')[0];
  const bk = wz.spells.list.filter((s) => o3.spells[s.key] && o3.spells[s.key].level >= 1 && o3.spells[s.key].level <= wz.maxLevel).map((s) => s.key).slice(0, 30);
  let pk = { cantrips: wz.cantrips.list.slice(0, wz.cantrips.count).map((s) => s.key), spells: bk, prepared: bk.slice(14, 30), show: 3 };
  for (let round = 1; round <= 2; round++) {
    spells.choose(w, { wizard: pk });
    o3 = spells.options(w); wz = o3.casters.filter((x) => x.key === 'wizard')[0];
    pk = { cantrips: wz.cantrips.chosen, spells: wz.spells.chosen, prepared: wz.prepared.chosen, show: 3 };
  }
  check('30-spell spellbook kept over two saves', wz.spells.chosen.length === 30, wz.spells.chosen.length + ' in the book');
  check('16 prepared kept over two saves', wz.prepared.chosen.length === 16, wz.prepared.chosen.length + ' prepared');
}
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

  // the spell key: the app re-runs options() only when it changes
  let k = spells.options(c).key;
  const same = (label) => { const k2 = spells.key(c); check('key: same after ' + label, k2 === k, k + ' → ' + k2); };
  const differs = (label) => { const k2 = spells.key(c); check('key: changes after ' + label, k2 !== k, k2); k = spells.options(c).key; check('key: options() gives it after ' + label, spells.key(c) === k, k); };
  same('options()');
  c.commit('HP Current', '5'); same('current HP');
  c.commit('Adventuring Gear Row 1', 'Rope'); same('a gear line');
  c.toggle('Condition.Poisoned'); same('a condition');
  c.commit('Wis', '18'); differs('Wisdom 18 (prepared count)');
  c.commit('Class and Levels', 'Cleric 4'); differs('a level up');
  c.commit('Class and Levels', 'Cleric (Life Domain) 4'); differs('a subclass with spells');
  for (let i = 0; i < 10; i++) c.commit('HP Current', String(i));
  same('ten HP changes');

  // Magic Initiate [Wizard] on a Fighter: bonus spells, one pick per slot, through MPMB's own spell dialog
  const seqC = c.logSeq;
  c.commit('Class and Levels', 'Fighter 3');
  c.queueDialog({ name: 'ASK USER DIALOG', steps: [{ set: { r000: false, r001: false, r002: true } }] });   // Wizard
  c.queueDialog({ name: 'ASK USER DIALOG', steps: [{ set: { r000: true, r001: false, r002: false } }] });   // Intelligence
  c.commit('Feat Name 1', 'Magic Initiate');
  const miOpts = spells.options(c);
  check('key: changes after Magic Initiate', miOpts.key !== k, miOpts.key);
  const mi = miOpts.casters.filter((x) => /magic initiate/.test(x.key))[0];
  check('Magic Initiate: three bonus slots', mi && mi.bonus && mi.bonus.length === 3 && mi.bonus[0].label === 'Cantrip' && mi.bonus[2].list.some((s) => s.key === 'magic missile'), mi && mi.bonus && mi.bonus.map((s) => s.label + ' (' + s.list.length + ')').join(', '));
  const seqG = c.logSeq;
  const mr = spells.choose(c, { [mi.key]: { cantrips: [], spells: [], prepared: [], bonus: ['fire bolt', 'light', 'magic missile'] } });
  const mk = mr.sheet.rows.map((x) => x.key);
  check('Magic Initiate: the picks are on the list', ['fire bolt', 'light', 'magic missile'].every((k) => mk.indexOf(k) !== -1), mk.join(', '));
  check('Magic Initiate: MPMB marks the 1st-level spell', /oncelr/.test(c.evalExpr('JSON.stringify(CurrentSpells[' + JSON.stringify(mi.key) + '].special)')), c.evalExpr('JSON.stringify(CurrentSpells[' + JSON.stringify(mi.key) + '].special)'));
  check('Magic Initiate: picker shows the picks again', spells.options(c).casters.filter((x) => x.key === mi.key)[0].bonus.map((s) => s.chosen).join(',') === 'fire bolt,light,magic missile');
  // making the list answers every MPMB dialog itself: nothing is left for the user (restart and replay would stop there)
  const left = c.log.dialogs.filter((d) => d.seq > seqG && d.answered === 'defaults').map((d) => d.name);
  check('making the list leaves no dialog to the user', !left.length, left.join(', '));
  check('Magic Initiate: no script errors', !c.log.errors.filter((x) => x.seq > seqC).length, c.log.errors.filter((x) => x.seq > seqC).map((x) => x.where + ': ' + x.msg).join(' | '));
}
check('no script errors', e.log.errors.length === 0, e.log.errors.map((x) => x.where + ': ' + x.msg + ' ' + x.at).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
