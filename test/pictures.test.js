// Pictures (MPMB's portrait, symbol and companion picture buttons), both ways: a picture picked in the app goes into
// the PDF as the button's icon with an appearance (so Acrobat shows it), and a picture in the PDF (as Acrobat stores
// one) is what the app shows. Uses MPMB's own picture menu (MakeIconMenu_IconOptions): "set" asks for a file
// (buttonImportIcon), "classicon#wizard" copies one of MPMB's own icons, "empty" clears it.
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const PDFLib = require('pdf-lib');
const { PDFName, PDFDict, PDFRef, PDFStream } = PDFLib;
const SRC = path.join(__dirname, '..', 'src');
const { load } = require(path.join(SRC, 'loader.js'));
const { write, iconPdf } = require(path.join(SRC, 'writer.js'));
const content = require(path.join(SRC, 'content.js'));
const engineSrc = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
function newEngine(modelJSON) {
  const ctx = vm.createContext({ __modelJSON: modelJSON });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(engineSrc, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const engine = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  engine.start();
  content.restore(engine);
  engine.drainChanges();
  return engine;
}
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(48), detail === undefined ? '' : String(detail).slice(0, 200)); };

// a 4 × 3 PNG with see-through pixels (as the app sends a PNG) and a 1 × 1 JPEG
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 200; raw[o + 1] = 30 * x; raw[o + 2] = 60; raw[o + 3] = x === 0 ? 0 : 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

(async () => {
  const bytes = fs.readFileSync((process.env.SHEET || path.join(__dirname, 'sheet.pdf')));
  const e = newEngine(fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8'));
  check('portrait starts with its own icon', e.snapshot('Portrait').icon === 'own:Portrait', e.snapshot('Portrait').icon);

  // "Set any image/pdf file as Portrait" without a picture: MPMB's buttonImportIcon is "cancelled", the app is told
  e.clearQueues(); e.queueMenu('set'); e.press('Portrait', 0);
  check('set without a picture: the app is asked for one', e.takeIconWanted() === 'Portrait' && e.snapshot('Portrait').icon === 'own:Portrait');
  // ... and with one (the app taps again with the picture queued)
  const portrait = { id: 'p1', mime: 'image/png', data: png(4, 3).toString('base64'), w: 4, h: 3 };
  e.clearQueues(); e.queueMenu('set'); e.queueIcon(portrait); e.press('Portrait', 0); e.clearQueues();
  check('set with a picture: the portrait shows it', e.snapshot('Portrait').icon === 'img:p1' && !e.snapshot('Portrait').hidden, e.snapshot('Portrait').icon);
  check('the app gets the picture back', JSON.stringify(e.iconInfo('Portrait').img) === JSON.stringify(portrait));
  // one of MPMB's own icons on the symbol, and a JPEG on the companion picture
  e.clearQueues(); e.queueMenu('classicon#wizard'); e.press('Symbol', 0); e.clearQueues();
  check('symbol: MPMB\'s wizard class icon', e.snapshot('Symbol').icon === 'fld:SaveIMG.ClassIcon.wizard', e.snapshot('Symbol').icon);
  const C = 'P4.AScomp.Comp.img.Portrait';
  e.clearQueues(); e.queueMenu('set'); e.queueIcon({ id: 'c1', mime: 'image/jpeg', data: JPEG, w: 1, h: 1 }); e.press(C, 0); e.clearQueues();
  check('companion picture: a JPEG', e.snapshot(C).icon === 'img:c1', e.snapshot(C).icon);
  check('no script errors', e.log.errors.length === 0, e.log.errors.slice(0, 3).map((x) => x.where + ': ' + x.msg).join(' | '));

  // the autosave keeps the pictures
  const st = e.exportState();
  const e1b = (() => { const ctx = vm.createContext({ __modelJSON: fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8') }); const ev = (c, n) => vm.runInContext(c, ctx, { filename: n || 'eval' }); ev(engineSrc, 'engine.js'); ctx.__host = { global: ctx, evalGlobal: ev }; const x = ev('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })'); x.importState(JSON.parse(JSON.stringify(st))); x.start(); return x; })();
  check('autosave: pictures restored', e1b.snapshot('Portrait').icon === 'img:p1' && e1b.snapshot('Symbol').icon === 'fld:SaveIMG.ClassIcon.wizard' && e1b.snapshot(C).icon === 'img:c1');

  // into the PDF
  const res = await write(new Uint8Array(bytes), st, PDFLib);
  check('write: nothing skipped', res.report.skipped.length === 0, res.report.skipped.slice(0, 5).join(' | '));
  const doc = await PDFLib.PDFDocument.load(res.bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context, L = (o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const widget = (n) => doc.getForm().getField(n).acroField.getWidgets()[0];
  const iconOf = (n) => { const mk = L(widget(n).dict.get(PDFName.of('MK'))); return mk instanceof PDFDict ? L(mk.get(PDFName.of('I'))) : null; };
  const imageIn = (form) => { const xo = form && L(L(form.dict.get(PDFName.of('Resources'))).get(PDFName.of('XObject'))); return xo ? xo.values().map(L).filter((x) => x instanceof PDFStream && String(x.dict.get(PDFName.of('Subtype'))) === '/Image')[0] : null; };
  const pi = imageIn(iconOf('Portrait'));
  check('PDF: the portrait\'s icon holds the picture', pi && String(pi.dict.get(PDFName.of('Width'))) === '4' && !!pi.dict.get(PDFName.of('SMask')), pi && pi.dict.toString().replace(/\s+/g, ' ').slice(0, 120));
  const ap = L(L(widget('Portrait').dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
  const r = widget('Portrait').getRectangle();
  const bbox = ap && L(ap.dict.get(PDFName.of('BBox'))).asArray().map((x) => x.asNumber());
  check('PDF: the portrait\'s appearance draws it', bbox && Math.abs(bbox[2] - r.width) < 0.01 && Math.abs(bbox[3] - r.height) < 0.01 && /\/FRM Do/.test(Buffer.from(PDFLib.decodePDFRawStream(ap).decode()).toString('latin1')), bbox && bbox.join(' '));
  check('PDF: both portrait buttons (two pages) show it', doc.getForm().getField('Portrait').acroField.getWidgets().every((w) => { const mk = L(w.dict.get(PDFName.of('MK'))); return mk && L(mk.get(PDFName.of('I'))) === iconOf('Portrait'); }));
  check('PDF: the symbol has MPMB\'s wizard icon', iconOf('Symbol') === iconOf('SaveIMG.ClassIcon.wizard'));
  const cj = imageIn(iconOf(C));
  check('PDF: the companion picture is a JPEG', cj && String(cj.dict.get(PDFName.of('Filter'))) === '/DCTDecode', cj && String(cj.dict.get(PDFName.of('Filter'))));
  fs.writeFileSync(path.join(__dirname, 'saved-pictures.pdf'), res.bytes);

  // and back: the written PDF opened as a new sheet (no saved state), as with a picture added in Acrobat
  const m2 = await load(res.bytes, PDFLib);
  const e2 = newEngine(JSON.stringify(m2));
  check('read back: the portrait shows its own icon', e2.snapshot('Portrait').icon === 'own:Portrait');
  const pdf = await iconPdf(doc, 'Portrait', e2.iconInfo('Portrait').size, PDFLib);
  const shown = pdf && await PDFLib.PDFDocument.load(pdf);
  const page = shown && shown.getPage(0);
  check('read back: the app gets the picture to show', !!pdf && /\/Subtype \/Image/.test(Buffer.from(pdf).toString('latin1')) && Math.abs(page.getWidth() - r.width) < 0.01, pdf ? pdf.length + ' bytes, page ' + page.getWidth().toFixed(1) + ' × ' + page.getHeight().toFixed(1) : 'none');
  const sym = await iconPdf(doc, 'Symbol', e2.iconInfo('Symbol').size, PDFLib);
  check('read back: the symbol (a PDF drawing) too', !!sym && sym.length > 1000, sym ? sym.length + ' bytes' : 'none');
  // a page spawned in the app isn't in the PDF yet: its picture comes from the template's button
  const spawned = await iconPdf(await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }), 'P9.AScomp.Comp.img.Portrait', [245, 151], PDFLib);
  check('a new companion page: the template\'s picture', !!spawned);
  // emptying a picture with MPMB's menu
  e2.clearQueues(); e2.queueMenu('empty'); e2.press('Portrait', 0); e2.clearQueues();
  check('empty: MPMB\'s empty icon', e2.snapshot('Portrait').icon === 'fld:SaveIMG.EmptyIcon', e2.snapshot('Portrait').icon);
  const res3 = await write(new Uint8Array(res.bytes), e2.exportState(), PDFLib);
  const doc3 = await PDFLib.PDFDocument.load(res3.bytes, { ignoreEncryption: true, updateMetadata: false });
  const mk3 = doc3.context.lookup(doc3.getForm().getField('Portrait').acroField.getWidgets()[0].dict.get(PDFName.of('MK')));
  check('empty: no icon in the PDF', !(mk3 instanceof PDFDict && mk3.get(PDFName.of('I'))));
  check('no script errors after reading back', e2.log.errors.length === 0, e2.log.errors.slice(0, 3).map((x) => x.where + ': ' + x.msg).join(' | '));
  console.log('wrote test/saved-pictures.pdf');
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error(err); process.exit(1); });
