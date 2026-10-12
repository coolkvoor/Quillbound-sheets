// Debug helper: run the self-test steps, then evaluate expressions inside the sheet's realm
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const selftest = require(path.join(SRC, 'selftest.js'));
const ctx = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
evalGlobal(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
ctx.__host = { global: ctx, evalGlobal };
const engine = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, {})');
engine.start();
const upto = Number(process.env.STEPS || selftest.steps.length);
for (const [op, f, v] of selftest.steps.slice(0, upto)) engine[op](f, v);
for (const ex of process.argv.slice(2)) { try { console.log(ex, '=>', JSON.stringify(evalGlobal(ex)).slice(0, 1500)); } catch (e) { console.log(ex, 'ERR', e.message); } }
console.log('errors:', engine.log.errors.map((e) => e.where + ': ' + e.msg + ' ' + e.at).join('\n'));
