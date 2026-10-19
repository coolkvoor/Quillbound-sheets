// Restart and replay (replay.js): MPMB's dialogs and questions answered by a scripted user without pausing MPMB.
// Each case is checked against a reference: the same answers given in one copy that really waits for the user
// (engine.interactive, as with Atomics.wait), started from the same state. The two must end with the same fields.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const selftest = require(path.join(SRC, 'selftest.js'));
const content = require(path.join(SRC, 'content.js'));
const replay = require(path.join(SRC, 'replay.js'));
const MODEL = fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8');
const ENGINE = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');

// a fresh copy of MPMB, started from a saved state (null: the sheet as distributed), as the worker opens one
function copy(state) {
  const ctx = vm.createContext({ __modelJSON: MODEL });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(ENGINE, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  e.setStandingAnswer('EXPERIENCE POINTS DIALOG', { steps: [{ end: 'cancel' }] });
  if (state) e.importState(JSON.parse(JSON.stringify(state)));
  e.start();
  content.restore(e);
  e.drainChanges();
  return e;
}

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(54), detail === undefined ? '' : String(detail).slice(0, 220)); };
const v = (e, n) => String(e.snapshot(n).value);

// A scripted user: rules matched against a dialog's title or name, each a list of replies given in turn
// (a reply may be a function of the request, to pick a list item by its name); dialogs without a rule get OK,
// questions get Yes. The descriptions come once per dialog, so they are kept by dialog id.
function scriptedUser(rules) {
  const seen = [], descs = {}, turn = {};
  const fn = (req) => {
    if (req.kind === 'question') { seen.push('question: ' + req.msg.slice(0, 50)); return { yes: true }; }
    if (req.desc) descs[req.id] = req.desc;
    const r = rules.find((x) => x.match.test(req.title || '') || x.match.test(req.name));
    const n = turn[req.id] = (turn[req.id] || 0) + 1;
    if (n === 1) seen.push(req.name + (req.title ? ' [' + req.title.slice(0, 40) + ']' : ''));
    const reply = r && r.replies[n - 1] !== undefined ? r.replies[n - 1] : { press: 'ok' };
    return typeof reply === 'function' ? reply(req, descs[req.id]) : reply;
  };
  fn.seen = seen;
  return fn;
}
// a reply that turns on the radio button whose label matches, and presses OK
const radio = (re) => (req, desc) => {
  const set = {};
  (function walk(x) { if (!x) return; if (x.type === 'radio') set[x.item_id] = re.test(x.name); (x.elements || []).forEach(walk); })(desc);
  return { set, press: 'ok' };
};

// the fields of two copies, compared after a change: names whose saved value differs
function differences(a, b) {
  const fa = a.exportState().fields, fb = b.exportState().fields, out = [];
  for (const n of new Set(Object.keys(fa).concat(Object.keys(fb)))) if (JSON.stringify(fa[n]) !== JSON.stringify(fb[n])) out.push(n);
  return out;
}

// one case: the change on the live copy through replay.act, and the reference with the same rules
let live;
async function run(label, rules, action, checks) {
  const before = live.exportState();
  const ref = copy(before);
  const refUser = scriptedUser(rules);
  ref.interactive(refUser);
  action(ref);
  ref.interactive(null);
  const user = scriptedUser(rules);
  const res = await replay.act({ live, fresh: copy, user }, action);
  live = res.engine;
  console.log('\n## ' + label + '\n   asked: ' + (user.seen.join(' | ') || 'nothing') + '\n   ' + res.restarts + ' restart(s), ' + res.restartMs + ' ms restarting, ' + res.ms + ' ms in all');
  check(label + ': same questions as the reference', JSON.stringify(user.seen) === JSON.stringify(refUser.seen), 'reference: ' + refUser.seen.join(' | '));
  const diff = differences(live, ref);
  check(label + ': same fields as the reference', !diff.length, diff.slice(0, 8).join(', '));
  for (const [name, ok, detail] of checks(live)) check(name, ok, detail);
  const errs = live.log.errors.slice(-5).map((x) => x.where + ': ' + x.msg);
  return errs;
}

(async () => {
  let t = Date.now();
  live = copy(null);
  const openMs = Date.now() - t;
  for (const [op, f, val] of selftest.steps) live[op](f, val);
  live.drainChanges();
  t = Date.now(); copy(live.exportState()); const restartOne = Date.now() - t;
  console.log('opening a copy from the sheet: ' + openMs + ' ms; from a saved Elf Wizard 3: ' + restartOne + ' ms');

  // nothing asked: one run, no restart
  let res = await replay.act({ live, fresh: copy, user: scriptedUser([]) }, (e) => e.commit('Feat Name 2', 'Alert'));
  live = res.engine;
  check('a change without dialogs: no restart', res.restarts === 0 && /alert/i.test(v(live, 'Feat Name 2')), res.restarts + ', ' + v(live, 'Feat Name 2'));

  await run('Magic Initiate → Wizard', [{ match: /Magic Initiate Type/, replies: [radio(/wizard/i)] }, { match: /Spellcasting Ability/, replies: [radio(/intelligence/i)] }],
    (e) => e.commit('Feat Name 1', 'Magic Initiate'),
    (e) => [['Magic Initiate [Wizard] with its text', v(e, 'Feat Name 1') === 'Magic Initiate [Wizard]' && /wizard spell list/i.test(v(e, 'Feat Description 1')), v(e, 'Feat Name 1')]]);

  await run('Species: Infernal Tiefling (from Elf)', [{ match: /Species Variant/, replies: [radio(/infernal/i)] }],
    (e) => e.commit('Race', 'Tiefling'),
    (e) => [['Infernal Tiefling', /infernal/i.test(v(e, 'Race')), v(e, 'Race')]]);

  await run('Species: Human, Small (after Tiefling)', [{ match: /Size Category/, replies: [radio(/small/i)] }, { match: /Origin Feat/, replies: [radio(/alert/i)] }],
    (e) => e.commit('Race', 'Human'),
    (e) => [['Human, MPMB knows it', /human/i.test(v(e, 'Race')) && /human/i.test(e.evalExpr('CurrentRace.known')), v(e, 'Race') + ' / ' + e.evalExpr('CurrentRace.known')],
      ['Human is Small', e.evalExpr('String(tDoc.getField("Size Category").currentValueIndices)') !== '' && /small/i.test(e.evalExpr('tDoc.getField("Size Category").getItemAt(tDoc.getField("Size Category").currentValueIndices, false)')), e.evalExpr('tDoc.getField("Size Category").getItemAt(tDoc.getField("Size Category").currentValueIndices, false)')]]);

  await run('Class Selection: + Fighter 1 (handlers run live)', [{ match: /CLASS SELECTION/, replies: [{ pick: { r1CD: 'Fighter' }, press: 'r1CD' }, { set: { r1LV: '1' }, press: 'r1LV' }, { press: 'ok' }] }, { match: /SUBCLASS/, replies: [{ press: 'cancel' }] }],
    (e) => e.runBookmark(['Functions', 'Class Selection']),
    (e) => [['Wizard 3, Fighter 1', /wizard 3/i.test(v(e, 'Class and Levels')) && /fighter 1/i.test(v(e, 'Class and Levels')), v(e, 'Class and Levels')]]);

  await run('Typing Fighter 3: subclass Champion', [{ match: /SUBCLASS/, replies: [radio(/champion/i)] }],
    (e) => e.commit('Class and Levels', 'Fighter 3'),
    (e) => [['Champion', /champion/i.test(v(e, 'Class and Levels')), v(e, 'Class and Levels')]]);

  await run('Weight dialog: coins out', [{ match: /CARRIED WEIGHT/, replies: [{ set: { cCoi: false }, press: 'ok' }] }],
    (e) => e.runBookmark(['Functions', 'Weight']),
    (e) => [['coins not counted', e.evalExpr('CurrentVars.weight.indexOf("cCoi")') === -1, e.evalExpr('JSON.stringify(CurrentVars.weight)')]]);

  console.log('\n' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
