// Speed test: the engine and MPMB's scripts in QuickJS (a JavaScript engine compiled to WebAssembly) against V8
// (Chrome's own engine, through Node's vm). QuickJS can pause in the middle of MPMB's code while the page waits for
// the user (the "asyncify" build), so dialogs would work in a Claude artifact or a single file, without hosting.
//   node proto/quickjs/bench.js [v8|sync|async ...]     (default: all three)
// Needs test/model.json (node test/loader.test.js).
const fs = require('fs'), path = require('path'), vm = require('vm');
const { newQuickJSWASMModule, newQuickJSAsyncWASMModule } = require('quickjs-emscripten');
const R = path.join(__dirname, '..', '..');
const SRC = path.join(R, 'src');
const MODEL = fs.readFileSync(path.join(R, 'test', 'model.json'), 'utf8');
const ENGINE = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(SRC, 'content.js'), 'utf8');
const SELFTEST = fs.readFileSync(path.join(SRC, 'selftest.js'), 'utf8');
// ADDON=1: also add the first add-on content file in resources/ (the owner's own, gitignored), as Add Extra Materials does
const RES = path.join(R, 'resources');
const ADDON = process.env.ADDON === '1' && fs.existsSync(RES) ? fs.readdirSync(RES).filter((n) => /\.js$/i.test(n)).sort()[0] : null;
const ADDON_TEXT = ADDON ? fs.readFileSync(path.join(RES, ADDON), 'utf8') : '';

// The same steps in every engine, timed inside it: open (MPMB's startup + Source Material → Apply, as the worker does),
// the Elf Wizard 3 self-test, then a few changes a player makes.
const STEPS = require('./steps');

function v8() {
  const ctx = vm.createContext({ __modelJSON: MODEL, __addonText: ADDON_TEXT });
  for (const [src, name] of [[ENGINE, 'engine.js'], [CONTENT, 'content.js'], [SELFTEST, 'selftest.js']]) vm.runInContext(src, ctx, { filename: name });
  return JSON.parse(vm.runInContext(STEPS, ctx, { filename: 'steps' }));
}

function setup(qjs) {
  const rt = qjs.newRuntime();
  rt.setMemoryLimit(-1);
  rt.setMaxStackSize(0);   // no limit: MPMB recurses deeply
  const ctx = rt.newContext();
  const run = (code, name) => { const r = ctx.evalCode(code, name); const v = ctx.unwrapResult(r); const out = ctx.dump(v); v.dispose(); return out; };
  const s = ctx.newString(MODEL); ctx.setProp(ctx.global, '__modelJSON', s); s.dispose();
  const a = ctx.newString(ADDON_TEXT); ctx.setProp(ctx.global, '__addonText', a); a.dispose();
  // console.log for debugging inside the VM
  const log = ctx.newFunction('log', (...a) => { console.log('  [vm]', ...a.map((h) => ctx.dump(h))); });
  ctx.setProp(ctx.global, '__log', log); log.dispose();
  run('var self = undefined; var module = undefined;', 'prelude');
  return { rt, ctx, run };
}

async function sync() {
  const t0 = Date.now();
  const qjs = await newQuickJSWASMModule();
  const { rt, ctx, run } = setup(qjs);
  for (const [src, name] of [[ENGINE, 'engine.js'], [CONTENT, 'content.js'], [SELFTEST, 'selftest.js']]) run(src, name);
  const load = Date.now() - t0;
  const out = JSON.parse(run(STEPS, 'steps'));
  out.loadWasm = load;
  ctx.dispose(); rt.dispose();
  return out;
}

// The asyncify build, plus a real pause: a dialog in the middle of MPMB's code waits for a "user" (a host Promise that
// answers after 300 ms) and MPMB carries on with the answer, as in Acrobat.
async function async_() {
  const t0 = Date.now();
  const qjs = await newQuickJSAsyncWASMModule();
  const { rt, ctx, run } = setup(qjs);
  for (const [src, name] of [[ENGINE, 'engine.js'], [CONTENT, 'content.js'], [SELFTEST, 'selftest.js']]) run(src, name);
  const load = Date.now() - t0;
  const out = JSON.parse(run(STEPS, 'steps'));
  out.loadWasm = load;
  // the pause: __ask(request JSON) is a host function that returns a Promise; QuickJS suspends until it resolves
  const asked = [];
  const ask = ctx.newAsyncifiedFunction('__ask', async (reqH) => {
    const req = JSON.parse(ctx.getString(reqH));
    asked.push(req.kind + ':' + (req.name || req.title));
    await new Promise((r) => setTimeout(r, 300));   // the user thinks it over
    const reply = req.kind === 'dialog' && req.name === 'CARRIED WEIGHT DIALOG' ? { set: { cCoi: false }, press: 'ok' } : { press: 'cancel' };
    return ctx.newString(JSON.stringify(reply));
  });
  ctx.setProp(ctx.global, '__ask', ask); ask.dispose();
  const before = run('JSON.stringify(CurrentVars.weight)');
  const tp = Date.now();
  const r = await ctx.evalCodeAsync('E.interactive(function (req) { return JSON.parse(__ask(JSON.stringify(req))); }); E.runBookmark(["Functions", "Weight"]); E.interactive(null); JSON.stringify(CurrentVars.weight);', 'pause');
  const v = ctx.unwrapResult(r); const after = ctx.dump(v); v.dispose();
  out.pause = { asked, before: JSON.parse(before), after: JSON.parse(after), ms: Date.now() - tp };
  ctx.dispose(); rt.dispose();
  return out;
}

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : ['v8', 'sync', 'async'];
  const rows = {};
  for (const w of which) {
    process.stdout.write('running ' + w + '… ');
    const t = Date.now();
    try { rows[w] = w === 'v8' ? v8() : w === 'sync' ? await sync() : await async_(); } catch (e) { rows[w] = { error: String(e && e.message || e).slice(0, 300) }; }
    console.log((Date.now() - t) + ' ms in all');
  }
  if (ADDON) console.log('add-on content: ' + ADDON);
  const keys = ['loadWasm', 'create', 'start', 'sources', 'addon', 'selftest', 'passed', 'levelUp', 'multiclass', 'feat', 'hp', 'longRest', 'cleric1to20', 'errors'];
  console.log('\n' + 'ms'.padEnd(12) + which.map((w) => w.padStart(10)).join(''));
  for (const k of keys) console.log(k.padEnd(12) + which.map((w) => String(rows[w][k] === undefined ? '' : rows[w][k]).padStart(10)).join(''));
  for (const w of which) if (rows[w].error) console.log(w, 'ERROR', rows[w].error);
  if (rows.async && rows.async.pause) console.log('\npause test:', JSON.stringify(rows.async.pause));
})();
