// The benchmark steps, run inside each engine (V8, QuickJS, QuickJS with pauses). Shared by bench.js (Node) and the
// phone test page (build-page.js). Globals the host sets first: __modelJSON (the loader model as JSON), __addonText.
module.exports = `
var __t = function () { return Date.now(); };
var __host = { global: globalThis, evalGlobal: function (c) { return (0, eval)(c); } };
var __times = {};
var __t0 = __t();
var E = MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: 'sheet.pdf' });
E.setStandingAnswer('EXPERIENCE POINTS DIALOG', { steps: [{ end: 'cancel' }] });
__times.create = __t() - __t0; __t0 = __t();
E.start();
__times.start = __t() - __t0; __t0 = __t();
MPMBContent.restore(E);
__times.sources = __t() - __t0; __t0 = __t();
if (__addonText) { MPMBContent.addFile(E, __addonText); __times.addon = __t() - __t0; __t0 = __t(); }
// in a function: MPMB's code sets a global i of its own
MPMBSelfTest.steps.forEach(function (s) { E[s[0]](s[1], s[2]); });
__times.selftest = __t() - __t0;
var __res = MPMBSelfTest.evaluate(function (n) { var s = E.snapshot(n); return s.exists ? (Array.isArray(s.value) ? s.value.join(',') : s.value) : '(missing)'; });
__times.passed = __res.filter(function (r) { return r.ok; }).length + '/' + __res.length;
__t0 = __t(); E.commit('Class and Levels', 'Wizard 5'); __times.levelUp = __t() - __t0;
__t0 = __t(); E.commit('Class and Levels', 'Wizard 5 Fighter 2'); __times.multiclass = __t() - __t0;
__t0 = __t(); E.commit('Feat Name 1', 'Alert'); __times.feat = __t() - __t0;
__t0 = __t(); E.commit('HP Current', '10'); __times.hp = __t() - __t0;
__t0 = __t(); E.press('LR', 0); __times.longRest = __t() - __t0;
__t0 = __t();
E.commit('Class and Levels', '');
for (var __lv = 1; __lv <= 20; __lv++) E.commit('Class and Levels', 'Cleric ' + __lv);
__times.cleric1to20 = __t() - __t0;
__times.errors = E.log.errors.length;
JSON.stringify(__times);
`;
