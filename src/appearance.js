/* Field appearances for the writer: how a text field, combo box or button caption looks in the saved PDF.
 * Acrobat keeps the look of a field (an appearance stream) next to its value, and shows that when the file opens. The
 * look of MPMB's fields comes from their Format scripts (bold feature names in the sheet's colour, "+2"); asking
 * viewers to redraw the fields (NeedAppearances) showed MPMB's markup instead, because Acrobat redraws before MPMB's
 * scripts are loaded. So the writer draws them, from the text and spans the engine's Format run gives:
 * - the field's own font, size (0: fitted, as Acrobat does) and colour from its DA, alignment (Q), one or more lines
 * - rich text spans: bold (the font's bold version when the sheet has one, e.g. "SegoePrint,Bold", else drawn
 *   heavier), italic (slanted), colour, size; MPMB's line spacing for its rich text fields
 * - characters outside the font's WinAnsi set (MPMB's ◆) from the embedded TrueType font itself (its cmap), through
 *   a copy of the font dictionary whose encoding names them
 * Works in a Web Worker and Node, with pdf-lib. */
(function (root) {
  'use strict';
  // Unicode → WinAnsiEncoding for the codes 0x80–0x9F (the rest of 0x20–0xFF is Latin-1)
  const WIN = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  const winAnsi = (cp) => (cp >= 0x20 && cp < 0x7F) || (cp >= 0xA0 && cp <= 0xFF) ? cp : WIN[cp];
  const num = (x) => +(+x).toFixed(3);
  // Characters the sheet's fonts haven't got (Acrobat takes them from a system font), drawn as shapes: w is the
  // advance per 1000, path(x, baseline, size) the filled outline
  const SHAPES = {
    0x25C6: { w: 722, path: (x, y, s) => { const cx = x + 0.361 * s, cy = y + 0.33 * s, hx = 0.3 * s, hy = 0.36 * s; return num(cx) + ' ' + num(cy + hy) + ' m ' + num(cx + hx) + ' ' + num(cy) + ' l ' + num(cx) + ' ' + num(cy - hy) + ' l ' + num(cx - hx) + ' ' + num(cy) + ' l h f'; } },
  };

  // A TrueType font program: the glyph and advance width for a character (cmap 3/1 format 4, hmtx)
  function trueType(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tables = {};
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      tables[String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))] = dv.getUint32(o + 8);
    }
    if (tables.cmap === undefined || tables.hmtx === undefined || tables.head === undefined || tables.hhea === undefined) return null;
    const upem = dv.getUint16(tables.head + 18) || 1000;
    const nMetrics = dv.getUint16(tables.hhea + 34);
    let sub = -1;
    const nt = dv.getUint16(tables.cmap + 2);
    for (let i = 0; i < nt; i++) {
      const p = dv.getUint16(tables.cmap + 4 + i * 8), e = dv.getUint16(tables.cmap + 6 + i * 8), off = dv.getUint32(tables.cmap + 8 + i * 8);
      if (p === 3 && e === 1 && dv.getUint16(tables.cmap + off) === 4) sub = tables.cmap + off;
    }
    if (sub === -1) return null;
    const segs = dv.getUint16(sub + 6) / 2;
    const ends = sub + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
    function glyph(cp) {
      if (cp > 0xFFFF) return 0;
      for (let i = 0; i < segs; i++) {
        if (dv.getUint16(ends + i * 2) < cp) continue;
        const start = dv.getUint16(starts + i * 2);
        if (start > cp) return 0;
        const ro = dv.getUint16(ranges + i * 2);
        if (!ro) return (cp + dv.getInt16(deltas + i * 2)) & 0xFFFF;
        const g = dv.getUint16(ranges + i * 2 + ro + (cp - start) * 2);
        return g ? (g + dv.getInt16(deltas + i * 2)) & 0xFFFF : 0;
      }
      return 0;
    }
    function advance(g) { const k = Math.min(g, nMetrics - 1); return dv.getUint16(tables.hmtx + k * 4) * 1000 / upem; }
    return { glyph, advance };
  }

  function create(PDFLib, doc) {
    const P = PDFLib, ctx = doc.context, N = (k) => P.PDFName.of(k);
    const L = (o) => (o instanceof P.PDFRef ? ctx.lookup(o) : o);
    const acro = L(doc.catalog.get(N('AcroForm')));
    const dr = acro instanceof P.PDFDict ? L(acro.get(N('DR'))) : null;
    const drFonts = dr instanceof P.PDFDict ? L(dr.get(N('Font'))) : null;
    const numsOf = (a) => { a = L(a); return a instanceof P.PDFArray ? a.asArray().map((x) => { x = L(x); return x instanceof P.PDFNumber ? x.asNumber() : 0; }) : null; };
    const numOf = (x) => { x = L(x); return x instanceof P.PDFNumber ? x.asNumber() : undefined; };
    const fonts = new Map();   // resource name in /DR -> font info (null when the sheet has no such font)

    // A font from the form's /DR by its resource name: widths per WinAnsi code, ascent and descent, and characters
    // outside WinAnsi on codes 1–31 of a copy of the font dictionary (encoding Differences "uniXXXX")
    function font(name) {
      if (fonts.has(name)) return fonts.get(name);
      const ref = drFonts ? drFonts.get(N(name)) : null;
      const dict = L(ref);
      if (!(dict instanceof P.PDFDict)) { fonts.set(name, null); return null; }
      const first = numOf(dict.get(N('FirstChar'))) || 0;
      const ws = numsOf(dict.get(N('Widths')));
      const fd = L(dict.get(N('FontDescriptor')));
      const std = String(dict.get(N('BaseFont')) || '');
      const avg = /Courier/.test(std) ? 600 : 520;
      const f = {
        name, ref, dict, extra: new Map(), derived: null, program: undefined,
        asc: (fd instanceof P.PDFDict && numOf(fd.get(N('Ascent')))) || 750,
        desc: (fd instanceof P.PDFDict && numOf(fd.get(N('Descent')))) || -250,
        extraWidth: new Map(),   // code -> width of the extra characters
        width(code) {
          if (code < 32) return f.extraWidth.get(code) || 0;
          const w = ws ? ws[code - first] : undefined;
          return w === undefined || w === null ? avg : w;
        },
      };
      f.prog = function () {
        if (f.program !== undefined) return f.program;
        f.program = null;
        const file = fd instanceof P.PDFDict ? L(fd.get(N('FontFile2'))) : null;
        if (file instanceof P.PDFStream && String(dict.get(N('Subtype'))) === '/TrueType') {
          try { f.program = trueType(P.decodePDFRawStream(file).decode()); } catch (e) { f.program = null; }
        }
        return f.program;
      };
      // a character outside WinAnsi: its code in the copy of the font (or undefined when the font has no glyph)
      f.extraCode = function (cp) {
        if (f.extra.has(cp)) return f.extra.get(cp).code;
        const prog = f.prog();
        const g = prog ? prog.glyph(cp) : 0;
        if (!g || f.extra.size >= 31) return undefined;
        const code = f.extra.size + 1;
        f.extra.set(cp, { code, width: prog.advance(g) });
        f.extraWidth.set(code, prog.advance(g));
        f.derived = null;   // made again with the new character (fontRef)
        return code;
      };
      fonts.set(name, f);
      return f;
    }
    // the font dictionary to draw with: the sheet's own, or its copy that also names the extra characters
    function fontRef(f, needsExtra) {
      if (!needsExtra || !f.extra.size) return f.ref;
      if (f.derived) return f.derived;
      const widths = [];
      for (let c = 0; c < 256; c++) widths.push(c >= 1 && c <= 31 ? 0 : f.width(c));
      const diffs = [1];
      const byCode = Array.from(f.extra.entries()).sort((a, b) => a[1].code - b[1].code);
      for (const [cp, e] of byCode) { diffs.push(N('uni' + cp.toString(16).toUpperCase().padStart(4, '0'))); widths[e.code] = num(e.width); }
      for (let c = 0; c < 256; c++) widths[c] = num(widths[c]);
      const copy = ctx.obj({});
      for (const [k, v] of f.dict.entries()) copy.set(k, v);
      copy.set(N('FirstChar'), P.PDFNumber.of(0));
      copy.set(N('LastChar'), P.PDFNumber.of(255));
      copy.set(N('Widths'), ctx.obj(widths));
      copy.set(N('Encoding'), ctx.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: diffs }));
      f.derived = ctx.register(copy);
      return f.derived;
    }
    // the bold version of a font in /DR, as Acrobat names them ("SegoePrint,Bold")
    function boldOf(name) {
      for (const n of [name + ',Bold', name + '-Bold', name + 'Bold', name.replace(/-?(Regular|Roman|Light)$/, '') + '-Bold']) if (n !== name && font(n)) return n;
      return null;
    }

    // A field's DA: font resource name, size and colour operator
    function parseDA(da) {
      const m = /\/([^\s/]+)\s+([\d.]+)\s+Tf/.exec(da || '');
      const col = /((?:[\d.]+\s+){1}g|(?:[\d.]+\s+){3}rg|(?:[\d.]+\s+){4}k)\s*$/.exec((da || '').trim());
      return { font: m ? m[1] : 'Helv', size: m ? Number(m[2]) : 0, color: col ? col[1] : '0 g' };
    }
    function colorOp(c, fill) {
      if (!Array.isArray(c)) return null;
      const v = c.slice(1).map((x) => num(x));
      if (c[0] === 'G') return v[0] + (fill ? ' g' : ' G');
      if (c[0] === 'RGB') return v.join(' ') + (fill ? ' rg' : ' RG');
      if (c[0] === 'CMYK') return v.join(' ') + (fill ? ' k' : ' K');
      return null;
    }
    const strokeOf = (op) => op.replace(/rg$/, 'RG').replace(/ g$/, ' G').replace(/ k$/, ' K');
    function mkColor(a) { a = numsOf(a); if (!a || !a.length) return null; return a.length === 1 ? a[0] + ' g' : a.length === 3 ? a.join(' ') + ' rg' : a.length === 4 ? a.join(' ') + ' k' : null; }

    // Draw one widget: { W, H, da, q, multiline, text, spans, lineHeight, mk } → appearance stream ref
    function draw(o) {
      const W = num(o.W), H = num(o.H), pad = 2;
      const da = parseDA(o.da);
      const base = font(da.font) || font('Helv');
      const boldName = base ? boldOf(base.name) : null;
      // runs of text with their style; Acrobat stores line breaks as CR
      const src = o.spans && o.spans.length ? o.spans : [{ text: o.text === undefined || o.text === null ? '' : String(o.text) }];
      const runs = src.map((s) => ({
        text: String(s.text === undefined ? '' : s.text).replace(/\r\n|\n/g, '\r'),
        bold: s.fontWeight !== undefined && (Number(s.fontWeight) >= 600 || s.fontWeight === 'bold'),
        italic: s.fontStyle === 'italic',
        color: colorOp(s.textColor, true),
        size: s.textSize ? Number(s.textSize) : 0,
      }));
      if (!o.multiline) for (const r of runs) r.text = r.text.replace(/\r/g, ' ');
      const fontOfRun = (r) => (r.bold && boldName ? font(boldName) : base);
      // a piece of text for a font, as segments: codes (WinAnsi, or extra characters from the font program), and
      // shapes for characters the font hasn't got but that are simple to draw (MPMB's ◆); "?" for anything else
      function encode(text, f) {
        const segs = [];
        let cur = null, extra = false;
        for (const ch of text) {
          const cp = ch.codePointAt(0);
          let c = winAnsi(cp);
          if (c === undefined && f) { c = f.extraCode(cp); if (c !== undefined) extra = true; }
          if (c === undefined && SHAPES[cp]) { segs.push({ shape: SHAPES[cp], w1000: SHAPES[cp].w }); cur = null; continue; }
          if (c === undefined) c = 0x3F;
          if (!cur) { cur = { codes: [], w1000: 0 }; segs.push(cur); }
          cur.codes.push(c);
          cur.w1000 += f ? f.width(c) : 520;
        }
        return { segs, extra, w1000: segs.reduce((s, x) => s + x.w1000, 0) };
      }
      // pieces: words, spaces and line breaks, each with its run's style
      const pieces = [];
      for (const r of runs) {
        const re = /(\r)|( +)|([^ \r]+)/g;
        let m;
        while ((m = re.exec(r.text))) {
          if (m[1]) { pieces.push({ br: true, run: r }); continue; }
          const f = fontOfRun(r);
          const e = encode(m[0], f);
          pieces.push({ text: m[0], space: !!m[2], run: r, f, segs: e.segs, extra: e.extra, w1000: e.w1000 });
        }
      }
      const sizeOf = (r, s) => (r.size || s);
      const asc = (base ? base.asc : 750) / 1000;
      // lines at a size: words wrap at the field's width (one line when not multiline)
      function layout(s) {
        const avail = W - pad * 2;
        const lines = [{ items: [], w: 0, size: 0 }];
        for (const p of pieces) {
          let line = lines[lines.length - 1];
          if (p.br) { lines.push({ items: [], w: 0, size: 0 }); continue; }
          const w = p.w1000 * sizeOf(p.run, s) / 1000;
          if (o.multiline && !p.space && line.items.length && line.w + w > avail) {
            // drop the spaces the line ended with
            while (line.items.length && line.items[line.items.length - 1].space) line.w -= line.items.pop().w;
            line = { items: [], w: 0, size: 0 };
            lines.push(line);
          }
          if (p.space && !line.items.length && lines.length > 1 && o.multiline) continue;
          line.items.push({ p, w });
          line.w += w;
          line.size = Math.max(line.size, sizeOf(p.run, s));
        }
        return lines;
      }
      // sizes and lines as Acrobat makes them (pdf.js copies the same rule): a fitted size is the height inside the
      // padding over 1.35, lines 1.35 × the size apart; MPMB's rich text fields have their own line spacing
      const LF = 1.35;
      let size = da.size;
      const lhOf = (s) => (o.lineHeight || s * LF);
      let lines;
      if (size > 0) lines = layout(size);
      else if (!o.multiline) {
        size = (H - pad * 2) / LF;
        lines = layout(size);
        const w = lines[0].w;
        if (w > W - pad * 2 && w > 0) { size = Math.max(2, size * (W - pad * 2) / w); lines = layout(size); }
      } else {
        for (size = 12; size > 4; size -= 0.5) { lines = layout(size); if (lines.length * lhOf(size) <= H - pad * 2) break; }
        if (!lines) lines = layout(size);
      }
      size = num(size);
      // the content: background and border as the widget's /MK has them, then the text, clipped to the field
      const out = [];
      if (o.mk) {
        const bg = mkColor(o.mk.bg), bc = mkColor(o.mk.bc);
        if (bg) out.push(bg, '0 0 ' + W + ' ' + H + ' re f');
        if (bc && o.mk.bw > 0) out.push(strokeOf(bc), num(o.mk.bw) + ' w', num(o.mk.bw / 2) + ' ' + num(o.mk.bw / 2) + ' ' + num(W - o.mk.bw) + ' ' + num(H - o.mk.bw) + ' re S');
      }
      out.push('/Tx BMC', 'q', '1 1 ' + num(W - 2) + ' ' + num(H - 2) + ' re W n', 'BT');
      const res = {};
      let resN = 0;
      const resOf = (ref) => { for (const k of Object.keys(res)) if (res[k] === ref) return k; const k = 'F' + (++resN); res[k] = ref; return k; };
      const lh = lhOf(size);
      // first baseline: below the top by the font's ascent (rich text, which then sits on the sheet's lines) or the
      // size; one line: centred on what letters cover (from the descent to the capital height, about -0.25 to 0.7)
      let y = o.multiline ? H - pad - (o.lineHeight ? asc : 1) * size : H / 2 - 0.225 * size;
      let curFont = '', curColor = '', curMode = 0;
      const shapes = [];   // drawn after the text (paths can't go inside BT … ET)
      for (const line of lines) {
        const lw = line.w;
        let x = o.q === 1 ? (W - lw) / 2 : o.q === 2 ? W - pad - lw : pad;
        for (const it of line.items) {
          const p = it.p, s = sizeOf(p.run, size);
          const col = p.run.color || da.color;
          let sx = x;
          if (!p.space) for (const seg of p.segs) {
            if (seg.shape) { shapes.push({ shape: seg.shape, x: sx, y, s, col }); sx += seg.w1000 * s / 1000; continue; }
            const ref = fontRef(p.f || base, p.extra);
            const tf = '/' + resOf(ref) + ' ' + num(s) + ' Tf';
            if (tf !== curFont) { out.push(tf); curFont = tf; }
            if (col !== curColor) { out.push(col); curColor = col; }
            // bold without a bold font: filled and outlined, a little heavier
            const mode = p.run.bold && !boldName ? 2 : 0;
            if (mode !== curMode) { out.push(mode ? strokeOf(col) + ' ' + num(s * 0.04) + ' w 2 Tr' : '0 Tr'); curMode = mode; }
            out.push('1 0 ' + (p.run.italic ? '0.2' : '0') + ' 1 ' + num(sx) + ' ' + num(y) + ' Tm');
            out.push('<' + seg.codes.map((c) => c.toString(16).padStart(2, '0')).join('') + '> Tj');
            sx += seg.w1000 * s / 1000;
          }
          x += it.w;
        }
        y -= o.multiline ? (o.lineHeight ? lh : Math.max(lh, line.size * LF)) : 0;
      }
      out.push('ET');
      for (const sh of shapes) out.push(sh.col, sh.shape.path(sh.x, sh.y, sh.s));
      out.push('Q', 'EMC');
      const fontRes = {};
      for (const k of Object.keys(res)) fontRes[k] = res[k];
      return ctx.register(ctx.stream(out.join('\n'), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, W, H], Resources: { Font: fontRes } }));
    }
    return { draw, parseDA };
  }

  const api = { create, trueType, winAnsi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBAppearance = api;
})(typeof self !== 'undefined' ? self : this);
