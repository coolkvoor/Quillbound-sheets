/* MPMB sheet loader: reads everything the engine needs out of an MPMB PDF.
 * Works in a browser page, a Web Worker and Node. Needs pdf-lib (global PDFLib or passed in).
 * Output is a plain, structured-cloneable object (the "sheet model"). */
(function (root) {
  'use strict';

  // PDFDocEncoding differs from Latin-1 in 0x18-0x1F and 0x80-0xA0
  const PDFDOC = {
    0x18: 0x02d8, 0x19: 0x02c7, 0x1a: 0x02c6, 0x1b: 0x02d9, 0x1c: 0x02dd, 0x1d: 0x02db, 0x1e: 0x02da, 0x1f: 0x02dc,
    0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026, 0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044,
    0x88: 0x2039, 0x89: 0x203a, 0x8a: 0x2212, 0x8b: 0x2030, 0x8c: 0x201e, 0x8d: 0x201c, 0x8e: 0x201d, 0x8f: 0x2018,
    0x90: 0x2019, 0x91: 0x201a, 0x92: 0x2122, 0x93: 0xfb01, 0x94: 0xfb02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160,
    0x98: 0x0178, 0x99: 0x017d, 0x9a: 0x0131, 0x9b: 0x0142, 0x9c: 0x0153, 0x9d: 0x0161, 0x9e: 0x017e, 0xa0: 0x20ac,
  };

  function decodeBytes(b) {
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
      let s = '';
      for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
      return s;
    }
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
    // No byte-order mark: MPMB's scripts are UTF-8 in practice; fall back to PDFDocEncoding if that fails
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { /* not UTF-8 */ }
    let out = '';
    const CH = 8192;
    for (let i = 0; i < b.length; i += CH) {
      const part = b.subarray(i, i + CH);
      const codes = new Array(part.length);
      for (let j = 0; j < part.length; j++) { const c = part[j]; codes[j] = PDFDOC[c] || c; }
      out += String.fromCharCode.apply(null, codes);
    }
    return out;
  }

  async function load(bytes, PDFLib, onProgress) {
    PDFLib = PDFLib || root.PDFLib;
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFNumber, PDFBool, PDFRef, PDFRawStream, PDFStream, decodePDFRawStream } = PDFLib;
    const progress = onProgress || (() => {});
    progress('Reading the PDF');
    const t0 = Date.now();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const ctx = doc.context;
    const parseMs = Date.now() - t0;

    const N = (k) => PDFName.of(k);
    const deref = (o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
    const get = (d, k) => (d && d.get ? deref(d.get(N(k))) : undefined);
    const has = (d, k) => !!(d && d.has && d.has(N(k)));
    const nameStr = (o) => { const s = o.asString().slice(1); return s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); };
    const streamText = (s) => {
      try {
        const bytes = s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents ? s.getContents() : new Uint8Array();
        return decodeBytes(bytes);
      } catch (e) { return ''; }
    };
    function val(o) {
      o = deref(o);
      if (o === undefined || o === null) return null;
      if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
      if (o instanceof PDFName) return nameStr(o);
      if (o instanceof PDFNumber) return o.asNumber();
      if (o instanceof PDFBool) return o.asBoolean ? o.asBoolean() : String(o) === 'true';
      if (o instanceof PDFArray) return o.asArray().map(val);
      if (o instanceof PDFRawStream || o instanceof PDFStream) return streamText(o);
      return null;
    }
    const num = (o) => { o = deref(o); return o instanceof PDFNumber ? o.asNumber() : 0; };
    const nums = (o) => { o = deref(o); return o instanceof PDFArray ? o.asArray().map(num) : null; };
    const js = (action) => {
      action = deref(action);
      if (!(action instanceof PDFDict)) return null;
      const s = get(action, 'S');
      if (!s || nameStr(s) !== 'JavaScript') return null;
      const code = get(action, 'JS');
      return code === undefined ? null : val(code);
    };
    const refKey = (r) => (r instanceof PDFRef ? r.objectNumber + ' ' + r.generationNumber : null);
    function nameTree(node, acc) {
      node = deref(node);
      if (!(node instanceof PDFDict)) return acc;
      const names = get(node, 'Names');
      if (names instanceof PDFArray) for (let i = 0; i + 1 < names.size(); i += 2) acc.push([val(names.get(i)), names.get(i + 1)]);
      const kids = get(node, 'Kids');
      if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) nameTree(kids.get(i), acc);
      return acc;
    }

    const catalog = doc.catalog;
    const names = get(catalog, 'Names');

    // Document-level scripts, in name-tree order (the order Acrobat runs them)
    progress('Reading the sheet’s scripts');
    const docScripts = nameTree(get(names, 'JavaScript'), []).map(([name, a]) => ({ name, code: js(a) || '' }));

    // Pages and template pages
    const pages = doc.getPages();
    const pageIndex = new Map(pages.map((p, i) => [refKey(p.ref), i]));
    const pageSizes = pages.map((p) => { const { width, height } = p.getSize(); return [width, height]; });
    const templates = nameTree(get(names, 'Templates'), []).map(([name, ref]) => ({ name, ref: refKey(ref) }));
    const templateIndex = new Map(templates.map((t) => [t.ref, t.name]));

    // Fields
    progress('Reading the form fields');
    const acro = get(catalog, 'AcroForm');
    const fields = {};
    const order = [];
    const keyToName = new Map();
    const inh = (d, k) => { let n = d, guard = 0; while (n instanceof PDFDict && guard++ < 50) { if (has(n, k)) return get(n, k); n = get(n, 'Parent'); } return undefined; };
    const FIELD_EVENTS = { K: 'K', F: 'F', V: 'V', C: 'C' };
    function walk(ref, prefix) {
      const d = deref(ref);
      if (!(d instanceof PDFDict)) return;
      const t = get(d, 'T');
      const name = t !== undefined ? (prefix ? prefix + '.' : '') + val(t) : prefix;
      const kids = get(d, 'Kids');
      const kidList = kids instanceof PDFArray ? kids.asArray() : [];
      const named = kidList.filter((k) => has(deref(k), 'T'));
      if (named.length) { named.forEach((k) => walk(k, name)); keyToName.set(refKey(ref), name); return; }
      const widgetRefs = kidList.length ? kidList : [ref];
      const ftObj = inh(d, 'FT');
      const f = {
        type: ftObj ? nameStr(ftObj) : null,
        ff: num(inh(d, 'Ff')),
        value: val(inh(d, 'V')),
        defaultValue: val(inh(d, 'DV')),
        opts: val(inh(d, 'Opt')),
        // the picked item's index, when two items share an export value (Medium and Small are both "1")
        index: val(get(d, 'I')),
        maxLen: num(inh(d, 'MaxLen')) || null,
        q: num(inh(d, 'Q')),
        da: val(inh(d, 'DA')),
        tu: val(get(d, 'TU')),
        tm: val(get(d, 'TM')),
        scripts: {},
        widgets: [],
      };
      const aa = get(d, 'AA');
      if (aa instanceof PDFDict) for (const [k, v] of aa.entries()) { const key = nameStr(k); const code = js(v); if (code && FIELD_EVENTS[key]) f.scripts[key] = code; }
      for (const wr of widgetRefs) {
        const w = deref(wr);
        if (!(w instanceof PDFDict)) continue;
        const pRef = w.get(N('P'));
        const pk = refKey(pRef);
        const wd = { page: pageIndex.has(pk) ? pageIndex.get(pk) : null, template: templateIndex.get(pk) || null, rect: nums(get(w, 'Rect')), flags: num(get(w, 'F')), scripts: {} };
        const a = js(get(w, 'A'));
        if (a) wd.scripts.A = a;
        const waa = get(w, 'AA');
        if (waa instanceof PDFDict) for (const [k, v] of waa.entries()) { const key = nameStr(k); const code = js(v); if (code && !FIELD_EVENTS[key]) wd.scripts[key] = code; }
        const mk = get(w, 'MK');
        if (mk instanceof PDFDict) { const ca = get(mk, 'CA'); if (ca !== undefined) wd.caption = val(ca); const bg = nums(get(mk, 'BG')); if (bg) wd.bg = bg; }
        const as = get(w, 'AS'); if (as instanceof PDFName) wd.as = nameStr(as);
        const ap = get(w, 'AP'); const apn = ap instanceof PDFDict ? get(ap, 'N') : null;
        if (apn instanceof PDFDict) wd.states = apn.keys().map(nameStr);
        f.widgets.push(wd);
        keyToName.set(refKey(wr), name);
      }
      keyToName.set(refKey(ref), name);
      fields[name] = f;
      order.push(name);
    }
    const top = get(acro, 'Fields');
    if (top instanceof PDFArray) top.asArray().forEach((r) => walk(r, ''));
    const co = get(acro, 'CO');
    const calcOrder = co instanceof PDFArray ? co.asArray().map((r) => keyToName.get(refKey(r))).filter((n) => n && fields[n] && fields[n].scripts.C) : [];

    // Document info (MPMB keeps its sheet type and version here)
    const info = {};
    const infoDict = doc.getInfoDict ? doc.getInfoDict() : null;
    if (infoDict) for (const [k, v] of infoDict.entries()) info[nameStr(k)] = val(v);

    // Bookmarks (MPMB reads their structure at startup and runs their scripts as menu items)
    function outline(node, depth) {
      const out = [];
      let c = get(node, 'First'), guard = 0;
      while (c instanceof PDFDict && guard++ < 2000) {
        out.push({ name: val(get(c, 'Title')) || '', js: js(get(c, 'A')), children: depth < 8 ? outline(c, depth + 1) : [] });
        c = get(c, 'Next');
      }
      return out;
    }
    const bookmarks = has(catalog, 'Outlines') ? outline(get(catalog, 'Outlines'), 0) : [];
    const docActions = {};
    const caa = get(catalog, 'AA');
    if (caa instanceof PDFDict) for (const [k, v] of caa.entries()) { const code = js(v); if (code) docActions[nameStr(k)] = code; }

    return {
      version: 1,
      info, docScripts, fields, fieldOrder: order, calcOrder, templates: templates.map((t) => t.name), bookmarks, docActions,
      pageCount: pages.length, pageSizes,
      stats: { parseMs, totalMs: Date.now() - t0, bytes: bytes.byteLength || bytes.length },
    };
  }

  const api = { load, decodeBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBLoader = api;
})(typeof self !== 'undefined' ? self : this);
