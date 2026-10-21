/* MPMB sheet writer: puts a saved character (engine.exportState) back into the sheet's own PDF with pdf-lib,
 * so the PDF stays the save file and opens in Acrobat with the character in it.
 * - replays the page changes: template pages spawned the way Acrobat does (a copy of the template page, its fields
 *   renamed "P<page>.<template>.<name>"), pages deleted, fields removed
 * - writes values, the field changes scripts made (hidden, read-only, tooltips, submitName, list items, scripts,
 *   captions, icons, colours, positions), the calculation order and the document info
 * - puts pictures the user picked (portrait, symbol) in as button icons, with an appearance that draws them
 * - draws how the changed fields look (appearance.js), from what MPMB's Format scripts show (state.look, given by the
 *   engine when saving: bold feature names, "+2"); Acrobat shows these when the file opens. Without state.look it
 *   asks viewers to redraw the fields instead (NeedAppearances), which in Acrobat leaves MPMB's formatting out.
 * Works in a Web Worker and Node. */
(function (root) {
  'use strict';
  const FF = { readonly: 1 << 0, required: 1 << 1, multiline: 1 << 12, password: 1 << 13, pushbutton: 1 << 16, combo: 1 << 17, edit: 1 << 18, multiSelect: 1 << 21, comb: 1 << 24, richText: 1 << 25 };
  const Appearance = typeof module !== 'undefined' && module.exports ? require('./appearance.js') : root.MPMBAppearance;
  const AF = { hidden: 2, print: 4, noView: 32 };
  const FIELD_KEYS = ['FT', 'Ff', 'V', 'DV', 'Opt', 'DA', 'Q', 'MaxLen', 'TU', 'TM', 'TI', 'RV', 'DS'];
  const FIELD_EVENTS = { K: 1, F: 1, V: 1, C: 1 };
  const TRIGGERS = { Keystroke: 'K', Validate: 'V', Calculate: 'C', Format: 'F', MouseUp: 'A', MouseDown: 'D', MouseEnter: 'E', MouseExit: 'X', OnFocus: 'Fo', OnBlur: 'Bl' };

  async function write(bytes, state, PDFLib, onProgress) {
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFNumber, PDFRef, PDFPage, PDFPageLeaf, PDFBool } = PDFLib;
    const progress = onProgress || (() => {});
    const report = { spawned: 0, deleted: 0, fields: 0, drawn: 0, skipped: [] };
    progress('Reading the PDF');
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const ctx = doc.context;
    const looks = state.look ? Appearance.create(PDFLib, doc) : null;   // field appearances (appearance.js)
    const N = (k) => PDFName.of(k);
    const deref = (o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
    const get = (d, k) => (d && d.get ? deref(d.get(N(k))) : undefined);
    const has = (d, k) => !!(d && d.has && d.has(N(k)));
    const text = (s) => PDFHexString.fromText(String(s));
    const nameStr = (o) => o.asString().slice(1).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const strOf = (o) => { o = deref(o); return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? nameStr(o) : ''; };
    const refKey = (r) => (r instanceof PDFRef ? r.objectNumber + ' ' + r.generationNumber : null);
    const inh = (d, k) => { let n = d, guard = 0; while (n instanceof PDFDict && guard++ < 50) { if (has(n, k)) return n.get(N(k)); n = get(n, 'Parent'); } return undefined; };

    const catalog = doc.catalog;
    const acro = get(catalog, 'AcroForm');
    const topFields = get(acro, 'Fields');

    // A font MPMB set (Text Options) that the form's /DR doesn't have: Acrobat adds the system font to /DR. Here a
    // copy of the nearest font there ("SegoeUI" for "SegoeUI-Semibold", else Helvetica's metrics), not embedded and
    // renamed, so Acrobat uses the system font by that name and other viewers substitute with fitting widths
    function ensureFont(name) {
      let dr = get(acro, 'DR');
      if (!(dr instanceof PDFDict)) { dr = ctx.obj({}); acro.set(N('DR'), dr); }
      let fonts = get(dr, 'Font');
      if (!(fonts instanceof PDFDict)) { fonts = ctx.obj({}); dr.set(N('Font'), fonts); }
      if (fonts.has(N(name))) return;
      const base = name.replace(/[-,]?(Semibold|SemiBold|Bold|Light|Regular|Italic)$/, '');
      const near = (base !== name && get(fonts, base)) || null;
      const font = ctx.obj({ Type: 'Font', Subtype: near ? 'TrueType' : 'Type1', BaseFont: name, Encoding: 'WinAnsiEncoding' });
      if (near) {
        for (const k of ['FirstChar', 'LastChar', 'Widths']) if (near.has(N(k))) font.set(N(k), near.get(N(k)));
        const fd = get(near, 'FontDescriptor');
        if (fd instanceof PDFDict) {
          const copy = ctx.obj({});
          for (const [k, v] of fd.entries()) if (!/^\/FontFile/.test(k.toString())) copy.set(k, v);
          copy.set(N('FontName'), N(name));
          if (/bold|semibold/i.test(name)) copy.set(N('FontWeight'), PDFNumber.of(/semibold/i.test(name) ? 600 : 700));
          font.set(N('FontDescriptor'), ctx.register(copy));
        }
      }
      fonts.set(N(name), ctx.register(font));
    }

    // ---- the form's fields by full name: terminal node (ref + dict) and its widgets (refs), as the loader reads them
    const index = new Map();      // full name -> { ref, dict, widgets: [ref] }
    const nodes = new Map();      // full name of any node -> { ref, dict }
    function walk(ref, prefix) {
      const d = deref(ref);
      if (!(d instanceof PDFDict)) return;
      const t = get(d, 'T');
      const name = t !== undefined ? (prefix ? prefix + '.' : '') + strOf(t) : prefix;
      nodes.set(name, { ref, dict: d });
      const kids = get(d, 'Kids');
      const kidList = kids instanceof PDFArray ? kids.asArray() : [];
      const named = kidList.filter((k) => has(deref(k), 'T'));
      if (named.length) { named.forEach((k) => walk(k, name)); return; }
      index.set(name, { ref, dict: d, widgets: kidList.length ? kidList.slice() : [ref] });
    }
    if (topFields instanceof PDFArray) topFields.asArray().forEach((r) => walk(r, ''));

    // ---- pages as they are now (refs), and the template pages by name
    const pages = doc.getPages().map((p) => p.ref);
    const templatePages = new Map();
    const names = get(catalog, 'Names');
    (function tree(node) {
      node = deref(node);
      if (!(node instanceof PDFDict)) return;
      const arr = get(node, 'Names');
      if (arr instanceof PDFArray) for (let i = 0; i + 1 < arr.size(); i += 2) templatePages.set(strOf(arr.get(i)), arr.get(i + 1));
      const kids = get(node, 'Kids');
      if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) tree(kids.get(i));
    })(get(names, 'Templates'));

    // a field node for a full name, created (with its parents) when missing
    function nodeFor(fullName) {
      if (nodes.has(fullName)) return nodes.get(fullName);
      const dot = fullName.lastIndexOf('.');
      const parentName = dot === -1 ? '' : fullName.slice(0, dot);
      const part = dot === -1 ? fullName : fullName.slice(dot + 1);
      const dict = ctx.obj({ T: text(part), Kids: [] });
      const ref = ctx.register(dict);
      if (parentName) { const p = nodeFor(parentName); dict.set(N('Parent'), p.ref); kidsOf(p.dict).push(ref); }
      else topFields.push(ref);
      const n = { ref, dict };
      nodes.set(fullName, n);
      return n;
    }
    function kidsOf(dict) { let k = get(dict, 'Kids'); if (!(k instanceof PDFArray)) { k = ctx.obj([]); dict.set(N('Kids'), k); } return k; }
    const removeFrom = (arr, ref) => { if (!(arr instanceof PDFArray)) return; for (let i = arr.size() - 1; i >= 0; i--) if (refKey(arr.get(i)) === refKey(ref)) arr.remove(i); };

    // ---- Acrobat's spawnPageFromTemplate: a copy of the template page, its fields renamed P<page>.<template>.<name>
    function spawn(tName, nPage, bRename, bOverlay) {
      const tRef = templatePages.get(tName);
      const tPage = deref(tRef);
      if (!tPage) { report.skipped.push('template ' + tName + ' not found'); return; }
      const at = nPage === null || nPage === undefined || nPage > pages.length ? pages.length : Math.max(0, nPage);
      if (bOverlay) { report.skipped.push('overlay spawn of ' + tName); return; }
      const leaf = PDFPageLeaf.fromMapWithContext(new Map(tPage.entries()), ctx);
      leaf.set(N('Type'), N('Page'));   // hidden template pages are /Type /Template; a spawned page is a normal page
      const pageRef = ctx.register(leaf);
      const annots = ctx.obj([]);
      leaf.set(N('Annots'), annots);
      const prefix = 'P' + at + '.' + tName + '.';
      // template fields with widgets on the template page, in field order (the engine's order)
      const tAnnots = get(tPage, 'Annots');
      const onPage = new Set((tAnnots instanceof PDFArray ? tAnnots.asArray() : []).map(refKey));
      const nonWidget = (tAnnots instanceof PDFArray ? tAnnots.asArray() : []).filter((r) => { const a = deref(r); return a && strOf(get(a, 'Subtype')) !== 'Widget'; });
      for (const r of nonWidget) annots.push(r);
      for (const [name, f] of Array.from(index.entries())) {
        const ws = f.widgets.filter((w) => onPage.has(refKey(w)));
        if (!ws.length) continue;
        if (bRename === false) {
          // same field, more widgets
          for (const w of ws) { const nw = cloneWidget(deref(w), pageRef, f.ref); const nr = ctx.register(nw); annots.push(nr); if (f.widgets.length === 1 && refKey(f.widgets[0]) === refKey(f.ref)) report.skipped.push('widget split of ' + name); else { kidsOf(f.dict).push(nr); f.widgets.push(nr); } }
          continue;
        }
        const full = prefix + name;
        if (index.has(full)) continue;
        // the new terminal field: the template field's own (inherited) entries, its widgets as kids
        const dot = full.lastIndexOf('.');
        const parent = nodeFor(full.slice(0, dot));
        const fd = ctx.obj({ T: text(full.slice(dot + 1)), Parent: parent.ref });
        for (const k of FIELD_KEYS) { const v = inh(f.dict, k); if (v !== undefined) fd.set(N(k), v); }
        const faa = fieldAA(f.dict);
        const fRef = ctx.register(fd);
        kidsOf(parent.dict).push(fRef);
        const kids = ctx.obj([]);
        const wRefs = [];
        for (const w of ws) { const nw = cloneWidget(deref(w), pageRef, fRef); const nr = ctx.register(nw); kids.push(nr); annots.push(nr); wRefs.push(nr); }
        if (faa) fd.set(N('AA'), faa);
        fd.set(N('Kids'), kids);
        index.set(full, { ref: fRef, dict: fd, widgets: wRefs });
        nodes.set(full, { ref: fRef, dict: fd });
      }
      doc.insertPage(at, PDFPage.of(leaf, pageRef, doc));
      pages.splice(at, 0, pageRef);
      report.spawned++;
    }
    function fieldAA(fd) {
      const aa = get(fd, 'AA');
      if (!(aa instanceof PDFDict)) return null;
      const out = ctx.obj({});
      for (const [k, v] of aa.entries()) if (FIELD_EVENTS[nameStr(k)]) out.set(k, v);
      return out.entries().length ? out : null;
    }
    function cloneWidget(w, pageRef, parentRef) {
      const nw = ctx.obj({});
      for (const [k, v] of w.entries()) {
        const key = nameStr(k);
        if (key === 'Parent' || key === 'P' || key === 'T' || FIELD_KEYS.indexOf(key) !== -1) continue;
        if (key === 'AA' && v) { const aa = deref(v); const out = ctx.obj({}); if (aa instanceof PDFDict) for (const [ak, av] of aa.entries()) if (!FIELD_EVENTS[nameStr(ak)]) out.set(ak, av); if (out.entries().length) nw.set(k, out); continue; }
        nw.set(k, v);
      }
      nw.set(N('P'), pageRef);
      nw.set(N('Parent'), parentRef);
      return nw;
    }

    // ---- deletePages: the pages go, and so do the widgets on them (and fields left without widgets)
    function deletePages(s, e) {
      const removed = pages.slice(s, e + 1);
      const gone = new Set(removed.map(refKey));
      for (const [name, f] of Array.from(index.entries())) {
        const keep = f.widgets.filter((w) => { const wd = deref(w); return !(wd && gone.has(refKey(wd.get(N('P'))))); });
        if (keep.length === f.widgets.length) continue;
        if (!keep.length) dropField(name);
        else { for (const w of f.widgets) if (keep.indexOf(w) === -1) removeFrom(get(f.dict, 'Kids'), w); f.widgets = keep; }
      }
      for (let i = e; i >= s; i--) doc.removePage(i);
      pages.splice(s, e - s + 1);
      report.deleted += removed.length;
    }
    // A field node leaves its parent's kids, and so does every parent left without kids: Acrobat takes an empty node
    // for a field without widgets, which broke MPMB's scripts in Acrobat (a removed companion page left 138 of them).
    function dropField(name) {
      const f = index.get(name) || nodes.get(name);
      if (!f) return;
      index.delete(name); nodes.delete(name);
      const p = get(f.dict, 'Parent');
      if (!p) { removeFrom(topFields, f.ref); return; }
      const kids = get(p, 'Kids');
      removeFrom(kids, f.ref);
      const dot = name.lastIndexOf('.');
      if (dot !== -1 && (!(kids instanceof PDFArray) || !kids.size()) && !has(p, 'Rect')) dropField(name.slice(0, dot));
    }
    // Acrobat's removeField: the node and everything under it (MPMB removes a deleted page's "P5.AScomp" this way)
    function removeField(name) {
      if (nodes.has(name) || index.has(name)) dropField(name);
      for (const n of Array.from(nodes.keys())) if (n.indexOf(name + '.') === 0) nodes.delete(n);
      for (const n of Array.from(index.keys())) if (n.indexOf(name + '.') === 0) index.delete(n);
    }

    progress('Adding the extra pages');
    for (const op of state.pageOps || []) {
      if (op[0] === 'spawn') spawn(op[1], op[2], op[3], op[4]);
      else if (op[0] === 'delete') deletePages(op[1], op[2]);
      else if (op[0] === 'remove') removeField(op[1]);
    }

    // ---- values and the changes scripts made to fields
    progress('Writing the character');
    const jsAction = (code) => ctx.obj({ S: 'JavaScript', JS: text(code) });
    const color = (c) => { if (!Array.isArray(c) || c[0] === 'T') return ctx.obj([]); return ctx.obj(c.slice(1).map(Number)); };
    function mk(w) { let m = get(w, 'MK'); if (!(m instanceof PDFDict)) { m = ctx.obj({}); w.set(N('MK'), m); } return m; }
    // ---- button pictures. A picture the user picked becomes an icon (/MK /I: a form XObject drawing the image), one
    // per picture however many buttons show it. Each button gets an appearance drawing its icon fitted the way Acrobat
    // does by default (in proportion, centred), so viewers that don't redraw buttons show it too.
    const pictures = new Map();   // picture id -> icon form ref
    const nums = (a) => (a instanceof PDFArray ? a.asArray().map((x) => (deref(x) instanceof PDFNumber ? deref(x).asNumber() : 0)) : null);
    async function pictureIcon(img) {
      if (pictures.has(img.id)) return pictures.get(img.id);
      const im = /png/i.test(img.mime) ? await doc.embedPng(fromBase64(img.data)) : await doc.embedJpg(fromBase64(img.data));
      const ref = ctx.register(ctx.stream('q ' + im.width + ' 0 0 ' + im.height + ' 0 0 cm /Im0 Do Q',
        { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, im.width, im.height], Resources: { XObject: { Im0: im.ref } } }));
      pictures.set(img.id, ref);
      return ref;
    }
    function iconAppearance(icon, rect) {
      const W = +Math.abs(rect[2] - rect[0]).toFixed(3), H = +Math.abs(rect[3] - rect[1]).toFixed(3);
      const ic = deref(icon);
      const d = ic && ic.dict;
      if (!d) return ctx.register(ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, W, H] }));
      const f = iconFit(nums(get(d, 'BBox')) || [0, 0, W, H], nums(get(d, 'Matrix')), W, H);
      return ctx.register(ctx.stream('q ' + f.map((x) => +x.toFixed(4)).join(' ') + ' cm /FRM Do Q',
        { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, W, H], Resources: { XObject: { FRM: icon } } }));
    }
    function setFlag(dict, bit, on) { const ff = deref(inh(dict, 'Ff')); let v = ff instanceof PDFNumber ? ff.asNumber() : 0; v = on ? v | bit : v & ~bit; dict.set(N('Ff'), PDFNumber.of(v)); }
    function setValue(f, v, ft, ff) {
      if (ft === 'Btn' && !(ff & FF.pushbutton)) {
        const on = v !== 'Off' && v !== '';
        f.dict.set(N('V'), N(on ? v : 'Off'));
        for (const wr of f.widgets) {
          const w = deref(wr);
          const ap = get(w, 'AP'); const apn = ap instanceof PDFDict ? get(ap, 'N') : null;
          const states = apn instanceof PDFDict ? apn.keys().map(nameStr) : [];
          w.set(N('AS'), N(on && states.indexOf(v) !== -1 ? v : 'Off'));
        }
        return;
      }
      if (Array.isArray(v)) f.dict.set(N('V'), ctx.obj(v.map(text)));
      else f.dict.set(N('V'), text(v));
      if (ff & FF.richText) f.dict.delete(N('RV'));   // the rich value is rebuilt from the value when the field is formatted
    }
    for (const name of Object.keys(state.fields || {})) {
      const f = index.get(name);
      const c = state.fields[name];
      if (!f) { report.skipped.push('no field ' + name); continue; }
      const ftObj = deref(inh(f.dict, 'FT'));
      const ft = ftObj ? nameStr(ftObj) : '';
      const ffObj = deref(inh(f.dict, 'Ff'));
      const ff = ffObj instanceof PDFNumber ? ffObj.asNumber() : 0;
      if (c.i) f.dict.set(N('Opt'), ctx.obj(c.i.map((it) => (it[0] === it[1] ? text(it[0]) : ctx.obj([text(it[1]), text(it[0])])))));
      if (c.v !== undefined) setValue(f, c.v, ft, ff);
      const p = c.p || {};
      // the picked item when two share an export value (/I, as Acrobat writes it)
      if (Number.isInteger(p.valueIndex)) f.dict.set(N('I'), ctx.obj([PDFNumber.of(p.valueIndex)]));
      else if (c.v !== undefined) f.dict.delete(N('I'));
      if (p.readonly !== undefined) setFlag(f.dict, FF.readonly, !!p.readonly);
      if (p.required !== undefined) setFlag(f.dict, FF.required, !!p.required);
      if (p.multiline !== undefined) setFlag(f.dict, FF.multiline, !!p.multiline);
      if (p.editable !== undefined) setFlag(f.dict, FF.edit, !!p.editable);
      if (p.userName !== undefined) f.dict.set(N('TU'), text(p.userName));
      if (p.submitName !== undefined) f.dict.set(N('TM'), text(p.submitName));
      if (p.defaultValue !== undefined) f.dict.set(N('DV'), text(p.defaultValue));
      if (p.charLimit !== undefined) f.dict.set(N('MaxLen'), PDFNumber.of(Number(p.charLimit) || 0));
      if (p.alignment !== undefined) f.dict.set(N('Q'), PDFNumber.of({ left: 0, center: 1, right: 2 }[p.alignment] || 0));
      if (p.textSize !== undefined || p.textFont !== undefined || p.textColor !== undefined) {
        const da = strOf(inh(f.dict, 'DA')) || '/Helv 0 Tf 0 g';
        let font = (/\/([^\s]+)\s+[\d.]+\s+Tf/.exec(da) || [])[1] || 'Helv', size = Number((/([\d.]+)\s+Tf/.exec(da) || [])[1] || 0);
        if (p.textFont !== undefined) { font = String(p.textFont).replace(/^Helvetica$/, 'Helv'); ensureFont(font); }
        if (p.textSize !== undefined) size = Number(p.textSize) || 0;
        let col = (/(?:[\d.]+\s+){0,4}[gk]$|(?:[\d.]+\s+){3}rg$/.exec(da.trim()) || ['0 g'])[0];
        if (Array.isArray(p.textColor)) { const tc = p.textColor; col = tc[0] === 'G' ? tc[1] + ' g' : tc[0] === 'RGB' ? tc.slice(1).join(' ') + ' rg' : tc[0] === 'CMYK' ? tc.slice(1).join(' ') + ' k' : '0 g'; }
        f.dict.set(N('DA'), PDFString.of('/' + font + ' ' + size + ' Tf ' + col));
        // a widget's own DA would win over the field's
        for (const wr of f.widgets) { const ww = deref(wr); if (ww && ww !== f.dict) ww.delete(N('DA')); }
      }
      // scripts attached with setAction: field events on the field, widget events on each widget
      if (c.s) {
        const aa = ctx.obj({});
        for (const k of Object.keys(c.s)) if (FIELD_EVENTS[k]) aa.set(N(k), jsAction(c.s[k]));
        f.dict.set(N('AA'), aa);
      }
      // widgets: how each one looks, its position and its scripts
      const ws = c.w || [];
      // what the field shows, to draw (when its value, list or text style changed)
      const shown = looks && state.look[name];
      const redraw = !!shown && (c.v !== undefined || !!c.i || p.richValue !== undefined || p.valueIndex !== undefined || p.textSize !== undefined
        || p.textFont !== undefined || p.textColor !== undefined || p.alignment !== undefined || p.multiline !== undefined);
      const multiline = p.multiline !== undefined ? !!p.multiline : !!(ff & FF.multiline);
      for (let i = 0; i < f.widgets.length; i++) {
        const w = deref(f.widgets[i]);
        if (!w) continue;
        const wp = (ws[i] && ws[i].p) || {};
        if (wp.display !== undefined) {
          let fl = deref(w.get(N('F'))); fl = fl instanceof PDFNumber ? fl.asNumber() : 0;
          fl &= ~(AF.hidden | AF.print | AF.noView);
          fl |= [AF.print, AF.hidden, 0, AF.noView | AF.print][Number(wp.display)] || 0;
          w.set(N('F'), PDFNumber.of(fl));
        }
        if (wp.fillColor !== undefined) mk(w).set(N('BG'), color(wp.fillColor));
        if (wp.strokeColor !== undefined) mk(w).set(N('BC'), color(wp.strokeColor));
        if (wp.caption !== undefined) mk(w).set(N('CA'), text(wp.caption));
        if (wp.lineWidth !== undefined || wp.borderStyle !== undefined) {
          let bs = get(w, 'BS'); if (!(bs instanceof PDFDict)) { bs = ctx.obj({}); w.set(N('BS'), bs); }
          if (wp.lineWidth !== undefined) bs.set(N('W'), PDFNumber.of(Number(wp.lineWidth) || 0));
          if (wp.borderStyle !== undefined) bs.set(N('S'), N({ solid: 'S', dashed: 'D', beveled: 'B', inset: 'I', underline: 'U' }[wp.borderStyle] || 'S'));
        }
        // a button's picture: one the user picked, or one copied from another button (MPMB keeps its pictures in
        // hidden "SaveIMG" buttons; SaveIMG.EmptyIcon has none, which empties the button)
        if (wp.icon && (wp.icon.img || wp.icon.name)) {
          let icon = null, known = true;
          if (wp.icon.img) icon = await pictureIcon(wp.icon.img);
          else {
            const src = index.get(wp.icon.name);
            const sw = src && deref(src.widgets[0]);
            const smk = sw ? get(sw, 'MK') : null;
            if (!sw) known = false; else icon = smk instanceof PDFDict ? smk.get(N('I')) || null : null;
          }
          if (known) {
            if (icon) mk(w).set(N('I'), icon); else mk(w).delete(N('I'));
            const rect = (c.r && c.r[i] ? c.r[i].map(Number) : null) || nums(get(w, 'Rect')) || [0, 0, 0, 0];
            w.set(N('AP'), ctx.obj({ N: iconAppearance(icon, rect) }));
          }
        }
        // how the field looks (appearance.js); a push button whose caption changed shows the new caption
        const caption = looks && wp.caption !== undefined && !wp.icon && ft === 'Btn' && (ff & FF.pushbutton);
        if ((redraw && !(ff & (FF.password | FF.comb))) || caption) {
          const rect = (c.r && c.r[i] ? c.r[i].map(Number) : null) || nums(get(w, 'Rect')) || [0, 0, 0, 0];
          const q = deref(w.get(N('Q'))) || deref(inh(f.dict, 'Q'));
          const wmk = get(w, 'MK'), bs = get(w, 'BS'), bw = bs instanceof PDFDict ? deref(bs.get(N('W'))) : null;
          const ap = looks.draw({
            W: Math.abs(rect[2] - rect[0]), H: Math.abs(rect[3] - rect[1]),
            da: strOf(w.get(N('DA'))) || strOf(inh(f.dict, 'DA')),
            q: caption ? 1 : q instanceof PDFNumber ? q.asNumber() : 0,
            multiline: caption ? false : multiline,
            text: caption ? wp.caption : shown.text, spans: caption ? null : shown.spans,
            lineHeight: !caption && (ff & FF.richText) ? state.lookLineHeight || 0 : 0,
            mk: wmk instanceof PDFDict ? { bg: wmk.get(N('BG')), bc: wmk.get(N('BC')), bw: bw instanceof PDFNumber ? bw.asNumber() : wmk.get(N('BC')) ? 1 : 0 } : null,
          });
          w.set(N('AP'), ctx.obj({ N: ap }));
          report.drawn++;
        }
        if (c.r && c.r[i]) w.set(N('Rect'), ctx.obj(c.r[i].map(Number)));
        if (ws[i] && ws[i].s) {
          const aa = ctx.obj({});
          for (const k of Object.keys(ws[i].s)) { if (k === 'A') w.set(N('A'), jsAction(ws[i].s.A)); else if (!FIELD_EVENTS[k]) aa.set(N(k), jsAction(ws[i].s[k])); }
          if (!ws[i].s.A) w.delete(N('A'));
          w.set(N('AA'), aa);
        }
      }
      report.fields++;
    }

    // ---- calculation order, document info, added document scripts
    if (Array.isArray(state.calcOrder)) acro.set(N('CO'), ctx.obj(state.calcOrder.map((n) => index.get(n)).filter(Boolean).map((f) => f.ref)));
    const infoDict = doc.getInfoDict ? doc.getInfoDict() : null;
    if (infoDict && state.info) for (const k of Object.keys(state.info)) { const v = state.info[k]; if (v !== null && v !== undefined && typeof v !== 'object') infoDict.set(N(k), text(v)); }
    if (state.docScripts && Object.keys(state.docScripts).length) {
      let js = get(names, 'JavaScript');
      if (!(js instanceof PDFDict)) { js = ctx.obj({ Names: [] }); names.set(N('JavaScript'), ctx.register(js)); }
      let arr = get(js, 'Names'); if (!(arr instanceof PDFArray)) { arr = ctx.obj([]); js.set(N('Names'), arr); }
      for (const k of Object.keys(state.docScripts)) { arr.push(text(k)); arr.push(ctx.register(jsAction(state.docScripts[k]))); }
    }
    // field appearances: drawn above when the engine gave what the fields show; otherwise viewers redraw them
    if (looks) acro.delete(N('NeedAppearances')); else acro.set(N('NeedAppearances'), PDFBool.True);
    // a script and flag an earlier version of the app added (a redraw in Acrobat that didn't work): taken out again
    {
      const js = get(names, 'JavaScript'), arr = get(js, 'Names');
      if (arr instanceof PDFArray) for (let i = arr.size() - 2; i >= 0; i -= 2) if (strOf(arr.get(i)) === 'zzMPMBSheetApp') { arr.remove(i + 1); arr.remove(i); }
      if (infoDict) infoDict.delete(N('MPMBSheetAppRedraw'));
    }
    progress('Saving the PDF');
    const out = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    return { bytes: out, report };
  }

  // How an icon (a form with bbox and matrix) is fitted into a W×H button: in proportion and centred, Acrobat's
  // default. Returns the matrix [s, 0, 0, s, tx, ty] for drawing the form. Also used to show pictures in the app.
  function iconFit(bbox, matrix, W, H) {
    const m = matrix && matrix.length === 6 ? matrix : [1, 0, 0, 1, 0, 0];
    const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const bw = x1 - x0 || 1, bh = y1 - y0 || 1, s = Math.min(W / bw, H / bh);
    return [s, 0, 0, s, (W - bw * s) / 2 - x0 * s, (H - bh * s) / 2 - y0 * s];
  }
  function fromBase64(b64) {
    if (typeof atob === 'function') { const t = atob(b64), out = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  // A button's icon in a PDF (read with pdf-lib) as a one-page PDF of the button's size (W × H) with the icon fitted in
  // as Acrobat draws it, for the app to show with pdf.js; null when the button has no icon. MPMB's own icons are PDF
  // drawings, and a picture added in Acrobat is an image inside such a drawing. A page spawned in the app isn't in
  // the PDF yet: its fields are copies of the template's ("P5.AScomp.Comp.img.Portrait" → "Comp.img.Portrait").
  async function iconPdf(doc, name, size, PDFLib) {
    const P = PDFLib, ctx = doc.context, N = (k) => P.PDFName.of(k);
    const L = (o) => (o instanceof P.PDFRef ? ctx.lookup(o) : o);
    const form = doc.getForm();
    const field = form.getFieldMaybe(name) || form.getFieldMaybe(name.replace(/^P\d+\.[^.]+\./, ''));
    const w = field && field.acroField.getWidgets()[0];
    const mk = w && L(w.dict.get(N('MK')));
    const iconRef = mk instanceof P.PDFDict ? mk.get(N('I')) : null;
    const icon = L(iconRef);
    if (!icon || !icon.dict) return null;
    const nums = (a) => { a = L(a); return a instanceof P.PDFArray ? a.asArray().map((x) => { x = L(x); return x instanceof P.PDFNumber ? x.asNumber() : 0; }) : null; };
    const W = size[0], H = size[1];
    const out = await P.PDFDocument.create();
    const copy = P.PDFObjectCopier.for(ctx, out.context).copy(iconRef instanceof P.PDFRef ? iconRef : ctx.register(icon));
    const page = out.addPage([W, H]);
    const key = page.node.newXObject('Icon', copy);
    const f = iconFit(nums(icon.dict.get(N('BBox'))) || [0, 0, W, H], nums(icon.dict.get(N('Matrix'))), W, H);
    page.pushOperators(P.pushGraphicsState(), P.concatTransformationMatrix(f[0], f[1], f[2], f[3], f[4], f[5]), P.drawObject(key), P.popGraphicsState());
    return out.save();
  }
  const api = { write, iconFit, iconPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBWriter = api;
})(typeof self !== 'undefined' ? self : this);
