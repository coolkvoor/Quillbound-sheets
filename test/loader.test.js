const fs = require('fs'), path = require('path');
const PDFLib = require('pdf-lib');
const { load } = require('../src/loader.js');
(async () => {
  const bytes = fs.readFileSync((process.env.SHEET || path.join(__dirname, 'sheet.pdf')));
  const m = await load(new Uint8Array(bytes), PDFLib, (s) => console.log('..', s));
  console.log('stats', m.stats, 'pages', m.pageCount, 'templates', m.templates.length, 'docScripts', m.docScripts.length, 'fields', Object.keys(m.fields).length, 'calcOrder', m.calcOrder.length, 'bookmarks', m.bookmarks.length);
  fs.writeFileSync(path.join(__dirname, 'model.json'), JSON.stringify(m));
  if (!process.argv[2]) { console.log('wrote test/model.json'); return; }
  // optional: compare with an earlier pikepdf extraction
  const ref = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  let diffs = 0;
  for (const [n, f] of Object.entries(ref.fields)) {
    const g = m.fields[n];
    if (!g) { if (diffs++ < 10) console.log('missing field', n); continue; }
    const a = JSON.stringify(f.value ?? null), b = JSON.stringify(g.value ?? null);
    if (a !== b && diffs++ < 10) console.log('value diff', n, a.slice(0, 80), b.slice(0, 80));
    for (const k of Object.keys(f.scripts)) if (!['K','F','V','C'].includes(k)) continue; else if (f.scripts[k].replace(/\r/g,'') !== (g.scripts[k] || '').replace(/\r/g,'') && diffs++ < 10) console.log('script diff', n, k);
    if (f.widgets.length !== g.widgets.length && diffs++ < 10) console.log('widget count diff', n);
    if (JSON.stringify(f.opts) !== JSON.stringify(g.opts) && diffs++ < 10) console.log('opts diff', n);
  }
  console.log('field diffs vs pikepdf:', diffs);
  const docDir = process.argv[3];
  let sdiff = 0;
  for (const s of m.docScripts) { const r = fs.readFileSync(path.join(docDir, s.name + '.js'), 'utf8'); if (r.replace(/\r/g,'') !== s.code.replace(/\r/g,'')) { sdiff++; console.log('doc script differs', s.name, r.length, s.code.length); } }
  console.log('doc script diffs:', sdiff, '; info', m.info.SheetVersion, m.info.SheetType);
  fs.writeFileSync(path.join(__dirname, 'model.json'), JSON.stringify(m));
  console.log('model json MB', (fs.statSync(path.join(__dirname, 'model.json')).size / 1e6).toFixed(1));
})().catch(e => { console.error(e); process.exit(1); });
