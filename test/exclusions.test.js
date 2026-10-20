// Single-item exclusions in Sources (content.excludeItems): MPMB's selection dialog for one kind, answered by a
// scripted user, then Source Selection → Apply. Done in a copy that waits for the user (engine.interactive) and by
// restart and replay (replay.js); both must end the same. Then the exclusion must survive the sheet's saved content
// (the app keeps CurrentSources.Stringified per sheet and restores it at every opening) and can be undone.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const content = require(path.join(SRC, 'content.js'));
const replay = require(path.join(SRC, 'replay.js'));
const MODEL = fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8');
const ENGINE = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');

// a fresh copy of MPMB: from a saved character (state) or with the sheet's content preset (saved), as the worker does
function copy(state, saved) {
  const ctx = vm.createContext({ __modelJSON: MODEL });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(ENGINE, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  if (state) e.importState(JSON.parse(JSON.stringify(state)));
  else if (saved) e.preset(saved);
  e.start();
  content.restore(e);
  e.drainChanges();
  return e;
}

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(60), detail === undefined ? '' : String(detail).slice(0, 220)); };

// the first leaf of a dialog's tree list whose name starts with `re`, inside a group whose name matches `group`
function leaf(obj, group, re) {
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    if (v && typeof v === 'object') { if (group.test(k)) { for (const n of Object.keys(v)) if (re.test(n)) return n; } const r = leaf(v, group, re); if (r) return r; }
  }
  return null;
}
// A scripted user for MPMB's class selection dialog: pick the subclass in "Included", move it to "Excluded" (or back),
// press Apply. `from`/`to`: IncL → ExcL excludes, ExcL → IncL includes again.
function mover(from, button, re) {
  const seen = [];
  let n = 0, item = null;
  const fn = (req) => {
    if (req.kind === 'question') { seen.push('question'); return { yes: true }; }
    n++;
    if (n === 1) { seen.push(req.name); item = leaf(req.values[from], /^Wizard/, re); fn.item = item; return item ? { pick: { [from]: item }, press: from } : { press: 'cancel' }; }
    if (n === 2) return { press: button };
    return { press: 'ok' };
  };
  fn.seen = seen;
  return fn;
}
const excluded = (e) => JSON.parse(e.evalExpr('JSON.stringify(CurrentSources.classExcl || [])'));
const subKey = (e) => e.evalExpr('(function () { for (var k in ClassSubList) if (/^Evoker/i.test(ClassSubList[k].subname)) return k; return ""; })()');

(async () => {
  const base = copy(null, null);
  const key = subKey(base);
  check('the SRD has the Evoker subclass', !!key, key);

  // 1. waiting for the user
  const ref = copy(base.exportState());
  const refUser = mover('IncL', 'BTL1', /^Evoker/);
  ref.interactive(refUser);
  const r1 = content.excludeItems(ref, 'class');
  ref.interactive(null);
  check('waiting: MPMB\'s class selection dialog was shown', refUser.seen[0] === 'SELECT CLASSES/ARCHETYPES DIALOG' || /DIALOG/.test(refUser.seen[0] || ''), refUser.seen.join(' | '));
  check('waiting: the subclass was in the list', !!refUser.item, refUser.item);
  check('waiting: changed, and Apply ran without errors', r1.changed && !r1.errors.length, r1.errors.join('; '));
  check('waiting: Evoker is excluded', excluded(ref).indexOf(key) !== -1, JSON.stringify(excluded(ref)));
  // the SRD Wizard has only this subclass, so MPMB moves the whole Wizard group and excludes the class as well
  check('waiting: the app\'s count matches MPMB\'s list', r1.content.excluded && r1.content.excluded.class === excluded(ref).length, JSON.stringify(r1.content.excluded));

  // 2. restart and replay
  const user = mover('IncL', 'BTL1', /^Evoker/);
  const res = await replay.act({ live: copy(base.exportState()), fresh: (st) => copy(st), user }, (e) => content.excludeItems(e, 'class'));
  const live = res.engine;
  check('replay: same dialog as waiting, ' + res.restarts + ' restart(s)', JSON.stringify(user.seen) === JSON.stringify(refUser.seen), user.seen.join(' | '));
  check('replay: Evoker is excluded', excluded(live).indexOf(key) !== -1, JSON.stringify(excluded(live)));
  check('replay: the stored sources are the same as waiting', live.snapshot('CurrentSources.Stringified').value === ref.snapshot('CurrentSources.Stringified').value);

  // 3. the sheet's content (what the app keeps per sheet) restored into a fresh sheet
  const saved = content.state(live);
  const again = copy(null, saved);
  check('restored: Evoker still excluded', excluded(again).indexOf(key) !== -1, JSON.stringify(excluded(again)));
  check('restored: the class menu leaves Evoker out', again.evalExpr('testSource("' + key + '", ClassSubList["' + key + '"], "classExcl") ? "out" : "in"') === 'out');

  // 4. Cancel changes nothing
  const cancelUser = (req) => (req.kind === 'question' ? { yes: false } : { press: 'cancel' });
  again.interactive(cancelUser);
  const r3 = content.excludeItems(again, 'class');
  again.interactive(null);
  check('cancel: nothing changed', !r3.changed && excluded(again).indexOf(key) !== -1);

  // 5. include it again
  const back = mover('ExcL', 'BTR1', /^Evoker/);
  again.interactive(back);
  const r4 = content.excludeItems(again, 'class');
  again.interactive(null);
  check('include again: Evoker is back', r4.changed && excluded(again).indexOf(key) === -1, JSON.stringify(excluded(again)));

  // 6. every kind opens its dialog without script errors (cancelled)
  for (const type of Object.keys(content.KINDS)) {
    const seen = [];
    again.interactive((req) => { if (req.kind === 'dialog' && req.desc) seen.push(req.name); return req.kind === 'question' ? { yes: false } : { press: 'cancel' }; });
    const r = content.excludeItems(again, type);
    again.interactive(null);
    check('kind "' + type + '": dialog shown, no errors', seen.length === 1 && !r.errors.length, (seen[0] || 'no dialog') + ' ' + r.errors.join('; '));
  }

  console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
