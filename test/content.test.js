// Adds an add-on content file through MPMB's own dialogs, changes sources, pastes a script, restores into a fresh realm.
// Usage: node test/content.test.js [file.js]   (default: the first .js file in resources/; skipped when there is none)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src');
const content = require(path.join(SRC, 'content.js'));

function pickFile() {
  if (process.argv[2]) return process.argv[2];
  const dir = path.join(ROOT, 'resources');
  const js = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.js$/i.test(f)).sort() : [];
  return js.length ? path.join(dir, js[0]) : null;
}
const file = pickFile();
if (!file) { console.log('SKIP no add-on content file (put one in resources/ or pass a path)'); process.exit(0); }
const modelJSON = fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8');
const engineSrc = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
function newEngine(saved) {
  const ctx = vm.createContext({ __modelJSON: modelJSON });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(engineSrc, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const engine = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  if (saved) engine.preset(saved);
  engine.start();
  if (saved) content.restore(engine);
  engine.drainChanges();
  return engine;
}

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(44), detail === undefined ? '' : String(detail).slice(0, 160)); };
const items = (engine, f) => engine.snapshot(f).items.map((i) => i[0]);
const src = (c, key) => c.sources.filter((s) => s.key === key)[0];
const t = (fn) => { const t0 = Date.now(); const r = fn(); r.ms = Date.now() - t0; return r; };

const text = fs.readFileSync(file, 'utf8');
console.log('content file', path.basename(file), (text.length / 1024).toFixed(0) + ' KB');
const e = newEngine();
const before = content.info(e);
check('fresh sheet: no files, SRD only', before.files.length === 0 && before.sources.length === 1 && before.sources[0].key === 'SRD24', before.sources.map((s) => s.key));

// 1. add the file
let r = t(() => content.addFile(e, text));
const c1 = r.content;
check('add file: MPMB reports success', r.alerts.some((a) => /success/i.test(a.title)), r.alerts.map((a) => a.title).join(', ') + ' in ' + r.ms + ' ms');
check('add file: no script errors', r.errors.length === 0, r.errors.join(' | '));
check('add file: stored as one file', c1.files.length === 1, c1.files.map((f) => f.key + ' ' + f.size));
check('add file: Aasimar in the Species list', items(e, 'Race').indexOf('Aasimar') !== -1, items(e, 'Race').join(', '));
check('add file: new sourcebooks listed', c1.sources.length > 1, c1.sources.map((s) => s.abbr + (s.excluded ? ' (excluded)' : '')).join(', '));
const phb = src(c1, 'PHB24');
check('add file: per-source counts', phb && phb.counts.subclass > 0, phb && JSON.stringify(phb.counts));

// 2. sources: include everything, then exclude the 2024 PHB and include it again
const excludedNow = c1.sources.filter((s) => s.excluded).map((s) => s.key);
r = t(() => content.setSources(e, []));
check('include all sources', r.content.sources.every((s) => !s.excluded) && r.errors.length === 0, (excludedNow.join(', ') || 'none were excluded') + ' → included in ' + r.ms + ' ms ' + r.errors.join(' | '));
r = content.setSources(e, ['PHB24']);
check('exclude PHB24: Aasimar leaves the list', src(r.content, 'PHB24').excluded && items(e, 'Race').indexOf('Aasimar') === -1, items(e, 'Race').join(', '));
r = content.setSources(e, []);
check('include PHB24 again: Aasimar is back', !src(r.content, 'PHB24').excluded && items(e, 'Race').indexOf('Aasimar') !== -1);

// 3. a pasted homebrew script, a faulty one, and removing it
const homebrew = 'RaceList["test folk"] = { regExpSearch: /^(?=.*test)(?=.*folk).*$/i, name: "Test Folk", source: ["HB", 0], plural: "Test Folk", size: 3, speed: { walk: { spd: 30, enc: 20 } }, trait: "Test Folk: made by the content test." };';
r = content.setUserScript(e, homebrew);
check('paste a script: Test Folk in the list', items(e, 'Race').indexOf('Test Folk') !== -1 && r.content.userScript > 0, r.alerts.map((a) => a.title).join(', '));
r = content.setUserScript(e, 'throw "boom";');
check('faulty script: MPMB reports it, keeps the old one', r.alerts.some((a) => /error/i.test(a.title)) && items(e, 'Race').indexOf('Test Folk') !== -1, r.alerts.map((a) => a.title).join(', '));
r = content.setUserScript(e, '');
check('remove the pasted script, file content stays', r.content.userScript === 0 && items(e, 'Race').indexOf('Test Folk') === -1 && items(e, 'Race').indexOf('Aasimar') !== -1 && r.content.sources.every((s) => !s.excluded));

// 4. what the app saves, restored into a fresh sheet
content.setSources(e, ['T']);
const saved = content.state(e);
check('saved state holds the file', saved['User_Imported_Files.Stringified'].length > text.length * 0.9, Object.keys(saved).map((k) => k + ' ' + saved[k].length).join(', '));
const t0 = Date.now();
const e2 = newEngine(saved);
const c2 = content.info(e2);
check('restore: same files and sources', c2.files.length === 1 && src(c2, 'T').excluded && !src(c2, 'P').excluded, 'start + restore ' + (Date.now() - t0) + ' ms');
check('restore: Aasimar in the list', items(e2, 'Race').indexOf('Aasimar') !== -1);
e2.commit('Race', 'Aasimar');
check('restore: Aasimar traits filled in', /Healing Hands/.test(e2.snapshot('Racial Traits').value), String(e2.snapshot('Racial Traits').value).split('\r')[0]);
check('restore: no script errors', e2.log.errors.length === 0, e2.log.errors.map((x) => x.where + ': ' + x.msg).join(' | '));

// 5. remove the file
r = content.removeFile(e, c1.files[0].key);
check('remove file: gone, Aasimar gone', r.content.files.length === 0 && items(e, 'Race').indexOf('Aasimar') === -1, r.alerts.map((a) => a.title).join(', '));
check('no script errors overall', e.log.errors.length === 0, e.log.errors.map((x) => x.where + ': ' + x.msg).join(' | '));
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exitCode = failed ? 1 : 0;
