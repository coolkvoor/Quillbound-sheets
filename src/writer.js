/* MPMB sheet writer: puts a saved character (engine.exportState) back into the sheet's own PDF with pdf-lib,
 * so the PDF stays the save file and opens in Acrobat with the character in it.
 * - replays the page changes: template pages spawned the way Acrobat does (a copy of the template page, its fields
 *   renamed "P<page>.<template>.<name>"), pages deleted, fields removed
 * - writes values, the field changes scripts made (hidden, read-only, tooltips, submitName, list items, scripts,
 *   captions, icons, colours, positions), the calculation order and the document info
 * - asks viewers to redraw the fields (NeedAppearances), since the app doesn't draw appearance streams
 * Works in a Web Worker and Node. */
(function (root) {
  'use strict';
  const FF = { readonly: 1 << 0, required: 1 << 1, multiline: 1 << 12, pushbutton: 1 << 16, combo: 1 << 17, edit: 1 << 18, multiSelect: 1 << 21, richText: 1 << 25 };
  const AF = { hidden: 2, print: 4, noView: 32 };
  const FIELD_KEYS = ['FT', 'Ff', 'V', 'DV', 'Opt', 'DA', 'Q', 'MaxLen', 'TU', 'TM', 'TI', 'RV', 'DS'];
  const FIELD_EVENTS = { K: 1, F: 1, V: 1, C: 1 };
  const TRIGGERS = { Keystroke: 'K', Validate: 'V', Calculate: 'C', Format: 'F', MouseUp: 'A', MouseDown: 'D', MouseEnter: 'E', MouseExit: 'X', OnFocus: 'Fo', OnBlur: 'Bl' };

  async function write(bytes, state, PDFLib, onProgress) {
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFNumber, PDFRef, PDFPage, PDFPageLeaf, PDFBool } = PDFLib;
    const progress = onProgress || (() => {});
    const report = { spawned: 0, deleted: 0, fields: 0, skipped: [] };
    progress('Reading the PDF');
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const ctx = doc.context;
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
    function dropField(name) {
      const f = index.get(name) || nodes.get(name);
      if (!f) return;
      const p = get(f.dict, 'Parent');
      if (p) removeFrom(get(p, 'Kids'), f.ref); else removeFrom(topFields, f.ref);
      index.delete(name); nodes.delete(name);
    }
    function removeField(name) {
      for (const n of Array.from(nodes.keys())) if (n === name || n.indexOf(name + '.') === 0) { if (index.has(n)) index.delete(n); nodes.delete(n); }
      const node = nodes.get(name);
      if (node) dropField(name);
      // the node itself may already be gone from the maps: remove by walking the parents
      const top = topFields.asArray();
      for (const r of top) { const d = deref(r); if (d && strOf(get(d, 'T')) === name) removeFrom(topFields, r); }
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
        if (p.textFont !== undefined) font = String(p.textFont).replace(/^Helvetica$/, 'Helv');
        if (p.textSize !== undefined) size = Number(p.textSize) || 0;
        let col = (/(?:[\d.]+\s+){0,4}[gk]$|(?:[\d.]+\s+){3}rg$/.exec(da.trim()) || ['0 g'])[0];
        if (Array.isArray(p.textColor)) { const tc = p.textColor; col = tc[0] === 'G' ? tc[1] + ' g' : tc[0] === 'RGB' ? tc.slice(1).join(' ') + ' rg' : tc[0] === 'CMYK' ? tc.slice(1).join(' ') + ' k' : '0 g'; }
        f.dict.set(N('DA'), PDFString.of('/' + font + ' ' + size + ' Tf ' + col));
      }
      // scripts attached with setAction: field events on the field, widget events on each widget
      if (c.s) {
        const aa = ctx.obj({});
        for (const k of Object.keys(c.s)) if (FIELD_EVENTS[k]) aa.set(N(k), jsAction(c.s[k]));
        f.dict.set(N('AA'), aa);
      }
      // widgets: how each one looks, its position and its scripts
      const ws = c.w || [];
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
        // a button icon copied from another button (MPMB keeps its images in hidden "SaveIMG" buttons)
        if (wp.icon && wp.icon.name) {
          const src = index.get(wp.icon.name);
          const sw = src && deref(src.widgets[0]);
          if (sw) {
            const smk = get(sw, 'MK'); const icon = smk instanceof PDFDict ? smk.get(N('I')) : null;
            if (icon) mk(w).set(N('I'), icon); else mk(w).delete(N('I'));
            const sap = sw.get(N('AP')); if (sap) w.set(N('AP'), sap);
          }
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
    // the app doesn't draw field appearances: viewers redraw them from the values
    acro.set(N('NeedAppearances'), PDFBool.True);

    progress('Saving the PDF');
    const out = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    return { bytes: out, report };
  }

  const api = { write };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBWriter = api;
})(typeof self !== 'undefined' ? self : this);
