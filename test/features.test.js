// Feature texts: every class and subclass levelled 1 → 20 one level at a time (as the app does), read with the app's
// own parser (src/features.js). Every feature must have a description, and the app must not offer "Rebuild feature
// texts". The one exception is MPMB's: a heading with a usage loses its short text when MPMB rewrites it on a level up
// (Wild Shape's "(see 3rd page)"), as in Acrobat.
// Usage: node test/features.test.js        SRD classes
//        node test/features.test.js all    also with the first add-on content file in resources/ (slow)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src');
const content = require(path.join(SRC, 'content.js')), classes = require(path.join(SRC, 'classes.js')), features = require(path.join(SRC, 'features.js'));

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; if (!ok || process.env.VERBOSE) console.log(ok ? 'PASS' : 'FAIL', label.padEnd(60), detail === undefined ? '' : String(detail).slice(0, 200)); };

// the parser on MPMB's line forms
const p = features.parse([
  '**Wizard, level 3:**',
  "#◆ Spellcasting# (Wizard 1, SRD'24 77) #[3 cantrips known & 6 spells to prepare]#",
  'I can cast Wizard spells.',
  "#◆ Expertise# (Rogue 1, SRD'24 61) [in 4 skills I'm proficient with]",
  "#◆ Scholar: Arcana# (Wizard 2, SRD'24 78) [Expertise in Arcana]",
  "#◆ Wild Shape# (Druid 2, SRD'24 42) #[regain 1/SR, 2× per Long Rest]# (see 3rd page)",
  "#◆ Reckless Attack# (Barbarian 2, SRD'24 29)",
  'As I roll my first attack…',
].join('\r'));
check('parser: group heading', p[0].group === 'Wizard, level 3', JSON.stringify(p[0]));
check('parser: usage and description', p[1].usage === '3 cantrips known & 6 spells to prepare' && p[1].text[0] === 'I can cast Wizard spells.', JSON.stringify(p[1]));
check('parser: description in brackets on the heading line (chip and text)', p[2].usage === "in 4 skills I'm proficient with" && p[2].text[0] === "In 4 skills I'm proficient with", JSON.stringify(p[2]));
check('parser: feature choice', p[3].name === 'Scholar: Arcana' && p[3].usage === 'Expertise in Arcana' && p[3].text[0] === 'Expertise in Arcana', JSON.stringify(p[3]));
check('parser: text after the usage', p[4].usage === 'regain 1/SR, 2× per Long Rest' && p[4].text[0] === '(see 3rd page)', JSON.stringify(p[4]));
check('parser: plain heading with text below', p[5].name === 'Reckless Attack' && p[5].text.length === 1, JSON.stringify(p[5]));
check('stale: a plain heading without text is old text', features.staleClassText("#◆ Ritual Adept# (Wizard 1, SRD'24 78)\r#◆ Scholar# (Wizard 2)\rtext"));
check('stale: a heading with a usage and nothing else is not', !features.staleClassText("#◆ Wild Shape# (Druid 2, SRD'24 42) #[regain 1/SR, 3× per Long Rest]#\r#◆ Next# (Druid 3)\rtext"));

const ctx = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') });
const ev = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
ev(fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8'), 'engine.js');
ctx.__host = { global: ctx, evalGlobal: ev };
const e = ev('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
e.start();
content.restore(e);
if (process.argv[2] === 'all') {
  const dir = path.join(ROOT, 'resources');
  const file = fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => /\.js$/i.test(f)).sort()[0];
  if (file) { const r = content.addFile(e, fs.readFileSync(path.join(dir, file), 'utf8')); check('add-on content added: ' + file, !r.errors.length, r.errors[0]); }
  else console.log('SKIP no add-on content file in resources/');
}

const t0 = Date.now();
let builds = 0;
for (const c of classes.options(e).classes) {
  for (const sub of c.subclasses.length ? c.subclasses : ['']) {
    classes.apply(e, []);
    e.evalExpr('Value("Class Features", "")');
    const empty = {}, errors = [];
    let stale = 0;
    for (let lv = 1; lv <= 20; lv++) {
      const r = classes.apply(e, [{ cls: c.name, sub: lv >= c.subclassLevel ? sub : '', level: lv }]);
      if (r.errors.length) errors.push(lv + ': ' + r.errors[0]);
      const text = String(e.snapshot('Class Features').value || '');
      for (const it of features.parse(text)) if (it.name && !it.text.length && !it.usage && !empty[it.name]) empty[it.name] = it.name + ' @' + lv;
      if (features.staleClassText(text) && !stale) stale = lv;
      builds++;
    }
    const label = c.name + (sub ? ' / ' + sub : '');
    check(label + ': no errors', !errors.length, errors[0]);
    check(label + ': every feature has a description', !Object.keys(empty).length, Object.values(empty).join('; '));
    check(label + ': no rebuild offered', !stale, 'at level ' + stale);
  }
}
classes.apply(e, []);
console.log(builds + ' levels built in ' + Math.round((Date.now() - t0) / 1000) + ' s');
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exit(failed ? 1 : 0);
