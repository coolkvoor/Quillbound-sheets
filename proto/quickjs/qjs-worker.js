// The phone test page's QuickJS worker (after the QJS bundle and SRC, the app's sources as strings).
// A request { mode: 'sync' | 'async', steps, model, addon } runs the benchmark steps in a fresh QuickJS; with 'async'
// MPMB's Weight dialog then really waits for the user: the worker posts { type: 'ask' } and QuickJS stays paused in the
// middle of MPMB's code until the page sends { type: 'answer', reply }.
var waiting = null;
self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type === 'answer') { if (waiting) { var w = waiting; waiting = null; w(m.reply); } return; }
  run(m).then(function (result) { postMessage({ ok: true, result: result }); },
    function (err) { postMessage({ ok: false, error: String(err && err.stack || err) }); });
};
async function run(m) {
  var t0 = Date.now();
  var qjs = m.mode === 'async' ? await QJS.newQuickJSAsyncWASMModuleFromVariant(QJS.asyncVariant) : await QJS.newQuickJSWASMModuleFromVariant(QJS.syncVariant);
  var rt = qjs.newRuntime();
  rt.setMemoryLimit(-1);
  rt.setMaxStackSize(0);   // no limit: MPMB recurses deeply
  var ctx = rt.newContext();
  function evalc(code, name) { var r = ctx.evalCode(code, name); var v = ctx.unwrapResult(r); var o = ctx.dump(v); v.dispose(); return o; }
  function setString(name, text) { var h = ctx.newString(text); ctx.setProp(ctx.global, name, h); h.dispose(); }
  setString('__modelJSON', m.model);
  setString('__addonText', m.addon || '');
  evalc('var self = undefined; var module = undefined;', 'prelude');
  evalc(SRC.engine, 'engine.js'); evalc(SRC.content, 'content.js'); evalc(SRC.selftest, 'selftest.js');
  var loadWasm = Date.now() - t0;
  var out = JSON.parse(evalc(m.steps, 'steps'));
  out.loadWasm = loadWasm;
  if (m.mode === 'async') {
    var asked = [];
    var ask = ctx.newAsyncifiedFunction('__ask', async function (reqH) {
      var req = JSON.parse(ctx.getString(reqH));
      asked.push(req.kind + ': ' + (req.name || req.title));
      if (req.kind !== 'dialog' || req.name !== 'CARRIED WEIGHT DIALOG') return ctx.newString(JSON.stringify({ press: 'cancel' }));
      postMessage({ type: 'ask', name: req.name, coins: !!req.values.cCoi });
      var reply = await new Promise(function (resolve) { waiting = resolve; });
      return ctx.newString(JSON.stringify(reply));
    });
    ctx.setProp(ctx.global, '__ask', ask); ask.dispose();
    var before = JSON.parse(evalc('JSON.stringify(CurrentVars.weight)'));
    var tp = Date.now();
    var r = await ctx.evalCodeAsync('E.interactive(function (req) { return JSON.parse(__ask(JSON.stringify(req))); }); E.runBookmark(["Functions", "Weight"]); E.interactive(null); JSON.stringify(CurrentVars.weight);', 'pause');
    var v = ctx.unwrapResult(r); var after = JSON.parse(ctx.dump(v)); v.dispose();
    out.pause = { asked: asked, before: before, after: after, waitedMs: Date.now() - tp };
  }
  ctx.dispose(); rt.dispose();
  return out;
}
