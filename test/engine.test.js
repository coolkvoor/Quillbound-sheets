// Runs MPMB's code in a fresh vm realm with the engine, builds the self-test character, prints results.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const model = fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8');
const selftest = require(path.join(SRC, 'selftest.js'));

const ctx = vm.createContext({ __modelJSON: model });
const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
evalGlobal(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
ctx.__host = { global: ctx, evalGlobal };
const engine = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
const t0 = Date.now();
engine.start();
console.log('startup ms', Date.now() - t0, 'errors', engine.log.errors.length);
for (const e of engine.log.errors.slice(0, 10)) console.log('  ERR', e.where, e.msg, e.at);
engine.drainChanges();
for (const [op, f, v] of selftest.steps) {
  const e0 = engine.log.errors.length, t = Date.now();
  const r = engine[op](f, v);
  const ch = engine.drainChanges();
  console.log(op, f, '=', v, JSON.stringify(r), (Date.now() - t) + 'ms', ch.length + ' fields changed', engine.log.errors.slice(e0).map((e) => e.where + ': ' + e.msg + ' ' + e.at).join(' | '));
}
const res = selftest.evaluate((n) => { const s = engine.snapshot(n); return s.exists ? (Array.isArray(s.value) ? s.value.join(',') : s.value) : '(missing)'; });
for (const r of res) console.log(r.ok ? 'PASS' : 'FAIL', r.label.padEnd(24), JSON.stringify(r.value), r.ok ? '' : 'expected ' + r.expected);
console.log('dialogs', engine.log.dialogs.map((d) => d.name).join(', '));
console.log('alerts', engine.log.alerts.length, 'menus', engine.log.menus.length, 'unsupported', JSON.stringify(engine.log.unsupported));
if (process.argv[2]) for (const n of process.argv.slice(2)) console.log('SNAP', JSON.stringify(engine.snapshot(n)).slice(0, 600));
process.exitCode = res.every((r) => r.ok) ? 0 : 1;
