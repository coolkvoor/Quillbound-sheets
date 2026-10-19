// MPMB's dialogs shown to a user (engine.interactive): a scripted "user" answers each request the way the app's
// dialog screen would (set values, pick list items, press buttons), synchronously, as the worker does with Atomics.wait.
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
e.setStandingAnswer('EXPERIENCE POINTS DIALOG', { steps: [{ end: 'cancel' }] });   // as the worker does
e.start();
content.restore(e);
for (const [op, f, v] of selftest.steps) e[op](f, v);
e.drainChanges();

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(50), detail === undefined ? '' : String(detail).slice(0, 220)); };
const errorsSince = (seq) => e.log.errors.filter((x) => x.seq > seq).map((x) => x.where + ': ' + x.msg);
// a user who answers with the given functions in turn (each gets the request, returns the reply); records the requests
function user(script) {
  const seen = [];
  e.interactive((req) => {
    seen.push(JSON.parse(JSON.stringify(req)));   // only plain data crosses to the app
    const f = script.shift();
    return f ? f(req) : null;
  });
  return seen;
}
const weight = () => JSON.parse(e.evalExpr('JSON.stringify(CurrentVars.weight)'));
const find = (desc, id) => { const st = [desc]; while (st.length) { const x = st.pop(); if (x.item_id === id) return x; for (const c of x.elements || []) st.push(c); } return null; };

// 1. Weight (Functions → Weight): untick coins, OK
let seq = e.logSeq;
const before = weight();
let seen = user([(r) => ({ set: { cCoi: false }, press: 'ok' })]);
e.runBookmark(['Functions', 'Weight']);
e.interactive(null);
const r0 = seen[0] || {};
check('Weight dialog shown to the user', seen.length === 1 && r0.kind === 'dialog' && r0.name === 'CARRIED WEIGHT DIALOG', seen.map((x) => x.kind + ':' + x.name).join(', '));
check('description: elements, no handlers', r0.desc && find(r0.desc, 'cCoi') && find(r0.desc, 'cCoi').type === 'check_box' && !/function/.test(JSON.stringify(r0.desc)), r0.desc && JSON.stringify(find(r0.desc, 'cCoi')));
check('values: what the dialog loaded', r0.values && r0.values.cCoi === before.includes('cCoi') && r0.values.rEnc !== undefined, JSON.stringify(r0.values));
check('OK: commit stored the choice', before.includes('cCoi') && !weight().includes('cCoi') && weight().length === before.length - 1, before + ' → ' + weight());
check('dialog log: answered by the user, ok', e.log.dialogs.some((d) => d.seq > seq && d.name === 'CARRIED WEIGHT DIALOG' && d.answered === 'user' && d.result === 'ok'), '');
check('no errors', !errorsSince(seq).length, errorsSince(seq).join('; '));

// 2. Cancel changes nothing
const mid = weight();
seen = user([(r) => ({ set: { cArm: false, cWea: false }, press: 'cancel' })]);
e.runBookmark(['Functions', 'Weight']);
e.interactive(null);
check('Cancel: nothing changed', JSON.stringify(weight()) === JSON.stringify(mid), weight());

// 3. Class Selection: a handler runs while the dialog is open (picking a class fills the row), then OK
seq = e.logSeq;
const states = [];
seen = user([
  (r) => { states.push(r); return { pick: { r1CD: 'Fighter' }, press: 'r1CD' }; },
  (r) => { states.push(r); return { set: { r1LV: '1' }, press: 'r1LV' }; },
  (r) => { states.push(r); return { press: 'ok' }; },
]);
e.runBookmark(['Functions', 'Class Selection']);
e.interactive(null);
const firstState = states[0] || {}, afterPick = states[1] || {};
check('Class Selection: 3 rounds with the user', states.length === 3 && seen.filter((x) => x.kind === 'dialog' && x.name === 'CLASS SELECTION DIALOG').length >= 3, seen.map((x) => x.kind + ':' + x.name).join(', '));
check('only the first round sends the description', !!firstState.desc && afterPick.desc === undefined);
check('class list is a list object (popup)', firstState.values && firstState.values.r1CD && typeof firstState.values.r1CD === 'object' && 'Fighter' in firstState.values.r1CD, firstState.values && JSON.stringify(firstState.values.r1CD).slice(0, 120));
check('the pick reached the handler (Fighter selected)', afterPick.values && afterPick.values.r1CD && afterPick.values.r1CD.Fighter > 0, afterPick.values && JSON.stringify(afterPick.values.r1CD).slice(0, 120));
check('handler changed what is enabled', afterPick.enabled && Object.keys(afterPick.enabled).length > 0, JSON.stringify(afterPick.enabled).slice(0, 160));
const cls = String(e.snapshot('Class and Levels').value);
check('OK: Wizard 3 + Fighter 1', /wizard/i.test(cls) && /fighter/i.test(cls) && String(e.snapshot('Character Level').value) === '4', cls + ', level ' + e.snapshot('Character Level').value);
const ask = seen.filter((x) => x.kind !== 'dialog' || x.name !== 'CLASS SELECTION DIALOG');
console.log('     other requests on the way:', ask.map((x) => x.kind + ':' + (x.name || x.title || '') + (x.msg ? ' "' + x.msg.slice(0, 60) + '"' : '')).join(' | ') || 'none');
check('no errors', !errorsSince(seq).length, errorsSince(seq).join('; '));

// 4. A dialog that opens inside the app's own screen (a subclass choice while applying classes) is shown to the user
seq = e.logSeq;
seen = user([(r) => ({ press: 'cancel' }), (r) => ({ press: 'cancel' }), (r) => ({ press: 'cancel' }), (r) => ({ press: 'cancel' })]);
classes.apply(e, [{ cls: 'Wizard', level: 3 }, { cls: 'Fighter', level: 3 }]);
e.interactive(null);
console.log('     shown while applying classes:', seen.map((x) => x.kind + ':' + (x.name || x.title || '')).join(', ') || 'none');
check('the app\'s own Class Selection answer is not shown', !seen.some((x) => x.name === 'CLASS SELECTION DIALOG'));
check('Fighter 3 applied', /fighter 3/i.test(String(e.snapshot('Class and Levels').value)), e.snapshot('Class and Levels').value);

// 5. A question while typing in a field goes to the user; "No" is MPMB's answer then
seq = e.logSeq;
seen = user([(r) => ({ yes: false }), (r) => ({ yes: false }), (r) => ({ yes: false })]);
e.commit('Race Remember', e.snapshot('Race Remember').value);   // no change: nothing asked
e.interactive(null);
check('no question without a change', !seen.length, seen.map((x) => x.kind).join(','));

// 6. Without a user nothing changes: defaults, as before
seq = e.logSeq;
e.runBookmark(['Functions', 'Weight']);
check('no user: dialog answered with its defaults', e.log.dialogs.some((d) => d.seq > seq && d.name === 'CARRIED WEIGHT DIALOG' && d.answered === 'defaults'));

console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
