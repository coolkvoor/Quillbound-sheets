// Ability scores through MPMB's Ability Scores dialog: read the columns, preview totals, apply point buy plus
// background bonuses, and check MPMB's results.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const content = require(path.join(SRC, 'content.js'));
const abilities = require(path.join(SRC, 'abilities.js'));
const ctx = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
evalGlobal(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
ctx.__host = { global: ctx, evalGlobal };
const e = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
e.start();
content.restore(e);
e.commit('Race', 'Elf'); e.commit('Class and Levels', 'Wizard 1');
e.drainChanges();

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(44), detail === undefined ? '' : String(detail).slice(0, 200)); };
const val = (n) => String(e.snapshot(n).value);

let o = abilities.options(e);
check('options: MPMB\'s columns', o.cols.length >= 8 && o.cols[0].type === 'base' && o.cols.some((c) => c.type === 'background'), o.cols.map((c) => c.name + (c.editable ? '' : ' (fixed)')).join(', '));
check('options: point buy costs', o.pointBuy.length === 8 && o.pointBuy[7][1] === 9, JSON.stringify(o.pointBuy));
check('options: explanation from MPMB', o.explain.length > 10, o.explain.replace(/\s+/g, ' ').slice(0, 120));

// point buy 15 14 13 12 10 8 (27 points) + background +2 Int +1 Dex
const scores = o.cols.map((c) => c.scores.slice());
scores[0] = [8, 13, 14, 15, 12, 10, 8];
const bg = o.cols.findIndex((c) => c.type === 'background');
scores[bg] = [0, 1, 0, 2, 0, 0, 0];
const pv = abilities.preview(e, scores);
check('preview: totals', pv[3].total === 17 && pv[1].total === 14 && pv[0].total === 8, pv.slice(0, 6).map((x) => x.total).join(' '));
check('preview: point buy 27', pv.slice(0, 6).reduce((a, x) => a + x.cost, 0) === 27, pv.slice(0, 6).map((x) => x.cost).join('+'));
const r = abilities.apply(e, scores);
check('apply: scores on the sheet', val('Int') === '17' && val('Dex') === '14' && val('Str') === '8', ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'].map((a) => a + ' ' + val(a)).join(', ') + ' ' + r.errors.join(' | '));
check('apply: modifiers follow', val('Int Mod') === '3' && val('Dex Mod') === '2', 'Int Mod ' + val('Int Mod'));
o = abilities.options(e);
check('options read the columns back', o.cols[0].scores.slice(0, 6).join() === '8,13,14,15,12,10' && o.cols[bg].scores[3] === 2 && o.current[3] === 17);

// a maximum: cap Int at 16
scores[o.cols.findIndex((c) => c.type === 'maximum')][3] = 16;
abilities.apply(e, scores);
check('maximum column caps the total', val('Int') === '16', 'Int ' + val('Int'));
check('no script errors', e.log.errors.length === 0, e.log.errors.map((x) => x.where + ': ' + x.msg + ' ' + x.at).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
