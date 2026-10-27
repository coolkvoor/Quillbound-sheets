/* Quillbound Sheets — dice: the dice screen (the die in the top bar) and the rolls behind the sheet's numbers.
   Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js).
   A roll never changes the sheet: it only shows numbers (and keeps the last ones per character, in the app). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, el, state, reduceMotion } = U;
  const idbGet = (...a) => U.idbGet(...a), idbPut = (...a) => U.idbPut(...a);

  const PADS = [4, 6, 8, 10, 12, 20, 100];
  const MAX_DICE = 100, KEEP = 50;

  // ---------------------------------------------------------------- rolling
  // a fair die: the browser's random numbers, without the bias a plain modulo gives
  function die(sides) {
    const a = new Uint32Array(1), lim = Math.floor(0x100000000 / sides) * sides;
    do crypto.getRandomValues(a); while (a[0] >= lim);
    return (a[0] % sides) + 1;
  }
  // "2d6 + 1d4 - 1", "d20+5", "d%": dice terms and a number; null when it isn't one
  function parse(text) {
    const s = String(text || '').replace(/[−–]/g, '-').replace(/\s+/g, '').toLowerCase().replace(/d%/g, 'd100');
    if (!s || !/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(s)) return null;
    const dice = [];
    let mod = 0, count = 0;
    for (const m of s.matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/g)) {
      const sign = m[1] === '-' ? -1 : 1;
      if (m[4] !== undefined) { mod += sign * Number(m[4]); continue; }
      const n = m[2] === '' ? 1 : Number(m[2]), sides = Number(m[3]);
      if (sides < 2 || sides > 1000) return null;
      count += n;
      if (n) dice.push({ n, sides, sign });
    }
    if (count > MAX_DICE) return null;
    return { dice, mod };
  }
  function format(p) {
    const parts = [];
    for (const d of p.dice) parts.push((parts.length ? (d.sign < 0 ? ' − ' : ' + ') : d.sign < 0 ? '−' : '') + d.n + 'd' + d.sides);
    if (p.mod || !parts.length) parts.push((parts.length ? (p.mod < 0 ? ' − ' : ' + ') : p.mod < 0 ? '−' : '') + Math.abs(p.mod));
    return parts.join('');
  }
  // a spec to roll anew: without the dice kept from the last roll
  const fresh = (spec) => { const c = Object.assign({}, spec); delete c.prev; return c; };
  const random = () => die(10000) / 10000;
  const bonus = (n) => (n < 0 ? '−' : '+') + Math.abs(n);
  // spec: { expr, what, kind, mode ('normal' | 'adv' | 'dis'), damage (an attack's damage spec), prev }
  // advantage takes the higher of two d20s (disadvantage the lower) for a roll with one d20.
  // prev: the d20s already rolled, kept when switching to advantage or disadvantage (only the missing one is rolled)
  function roll(spec) {
    const p = parse(spec.expr);
    if (!p) return null;
    const d20 = p.dice.length === 1 && p.dice[0].n === 1 && p.dice[0].sides === 20;
    const mode = d20 ? spec.mode || 'normal' : 'normal';
    const groups = p.dice.map((d) => {
      const n = d.n;
      const rolls = [];
      const kept = d20 && spec.prev ? spec.prev.slice(0, mode === 'normal' ? 1 : 2) : [];
      for (let i = 0; i < (mode === 'normal' ? n : 2); i++) rolls.push(i < kept.length ? kept[i] : die(d.sides));
      let drop = -1;
      if (mode !== 'normal') drop = (mode === 'adv') === (rolls[0] < rolls[1]) ? 0 : 1;
      return { sides: d.sides, sign: d.sign, rolls, drop, kept: kept.length };
    });
    let total = p.mod;
    for (const g of groups) g.rolls.forEach((r, i) => { if (i !== g.drop) total += g.sign * r; });
    const nat = d20 ? groups[0].rolls[groups[0].drop === 0 ? 1 : 0] : null;
    return { spec: Object.assign(fresh(spec), { mode }), expr: format(p), d20, groups, mod: p.mod, total, nat, at: Date.now() };
  }
  function breakdown(r) {
    const parts = [];
    for (const g of r.groups) {
      const shown = g.rolls.map((x, i) => (i === g.drop ? '(' + x + ')' : String(x))).join(', ');
      parts.push((parts.length || g.sign < 0 ? (g.sign < 0 ? '− ' : '+ ') : '') + (g.rolls.length - (g.drop >= 0 ? 1 : 0)) + 'd' + g.sides + ' [' + shown + ']');
    }
    if (r.mod) parts.push((r.mod < 0 ? '− ' : '+ ') + Math.abs(r.mod));
    return parts.join(' ');
  }
  const MODE_NAME = { adv: 'advantage', dis: 'disadvantage' };
  function note(r) {
    const k = r.spec.kind;
    if (k === 'death') return r.nat === 20 ? 'Natural 20: you regain 1 hit point' : r.nat === 1 ? 'Natural 1: two failures' : r.total >= 10 ? 'Success' : 'Failure';
    if (r.nat === 20) return k === 'attack' ? 'Natural 20: a critical hit' : 'Natural 20';
    if (r.nat === 1) return k === 'attack' ? 'Natural 1: a miss' : 'Natural 1';
    return '';
  }

  // ---------------------------------------------------------------- drawing dice: small 3D solids on a canvas
  // Each die is its own solid (d4 tetrahedron, d6 cube, d8 octahedron, d10 pentagonal trapezohedron, d12 dodecahedron,
  // d20 icosahedron; d100 a d10 counting in tens), flat-shaded with a light from the top left. A roll spins it about a
  // random axis, slowing down until the face with the result looks straight at you. Numbers stay upright on screen.
  const PHI = (1 + Math.sqrt(5)) / 2;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // turns as quaternions [w, x, y, z]; mul(a, b) turns by b, then by a
  const turn = (axis, ang) => { const s = Math.sin(ang / 2), n = unit(axis); return [Math.cos(ang / 2), n[0] * s, n[1] * s, n[2] * s]; };
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  const rot = (q, v) => {
    const [w, x, y, z] = q, t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
    return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
  };
  // the turn that points direction n at the viewer (+z)
  function facing(n) {
    if (n[2] > 0.9999) return [1, 0, 0, 0];
    if (n[2] < -0.9999) return turn([1, 0, 0], Math.PI);
    return turn(cross(n, [0, 0, 1]), Math.acos(n[2]));
  }
  // a convex solid's faces from its dual: each direction's face holds the vertices furthest along it, in order around it
  function faces(verts, dirs) {
    return dirs.map((d0) => {
      const n = unit(d0), dots = verts.map((v) => dot(v, n)), top = Math.max(...dots);
      const idx = [];
      dots.forEach((x, i) => { if (x > top - 1e-4) idx.push(i); });
      const p = verts[idx[0]], u = unit([p[0] - n[0] * top, p[1] - n[1] * top, p[2] - n[2] * top]), w = cross(n, u);
      const ang = (i) => Math.atan2(dot(verts[i], w), dot(verts[i], u));
      idx.sort((a, b) => ang(a) - ang(b));
      return { idx, n };
    });
  }
  // the d10: two rings of five, half a step apart, and two tips; c keeps the kites flat
  function trapezohedron() {
    const a = 0.1, c = a * (1 + Math.cos(Math.PI / 5)) / (1 - Math.cos(Math.PI / 5));
    const verts = [[0, 0, c], [0, 0, -c]];
    for (let k = 0; k < 5; k++) verts.push([Math.cos(k * 2 * Math.PI / 5), Math.sin(k * 2 * Math.PI / 5), a]);
    for (let k = 0; k < 5; k++) verts.push([Math.cos(k * 2 * Math.PI / 5 + Math.PI / 5), Math.sin(k * 2 * Math.PI / 5 + Math.PI / 5), -a]);
    const fs = [];
    for (let k = 0; k < 5; k++) fs.push([0, 2 + k, 7 + k, 2 + (k + 1) % 5], [1, 7 + k, 2 + (k + 1) % 5, 7 + (k + 1) % 5]);
    return { verts, faces: fs.map((idx) => {
      const [p, q, r] = idx.map((i) => verts[i]);
      let n = unit(cross([q[0] - p[0], q[1] - p[1], q[2] - p[2]], [r[0] - p[0], r[1] - p[1], r[2] - p[2]]));
      const m = idx.reduce((s, i) => [s[0] + verts[i][0], s[1] + verts[i][1], s[2] + verts[i][2]], [0, 0, 0]);
      if (dot(n, m) < 0) n = n.map((x) => -x);
      return { idx, n };
    }) };
  }
  // a number's size, as a share of the die's box: about the same on every die, a little smaller where the face is small
  const LABEL = { 4: 0.27, 6: 0.3, 8: 0.27, 10: 0.24, 12: 0.27, 20: 0.22 };
  const SOLIDS = {};
  // an unusual die (d3, d7…) borrows the next solid up and shows only its result
  const shapeFor = (sides) => (sides === 100 ? 10 : sides <= 4 ? 4 : sides <= 6 ? 6 : sides <= 8 ? 8 : sides <= 10 ? 10 : sides <= 12 ? 12 : 20);
  function solid(sides) {
    const k = shapeFor(sides);
    if (SOLIDS[k]) return SOLIDS[k];
    const cube = [], ico = [], dod = [], t = 1 / PHI;
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cube.push([x, y, z]);
    for (const a of [-1, 1]) for (const b of [-1, 1]) ico.push([0, a, b * PHI], [a, b * PHI, 0], [a * PHI, 0, b]);
    dod.push(...cube);
    // turned to match the icosahedron: each one's vertices point at the other's faces
    for (const a of [-1, 1]) for (const b of [-1, 1]) dod.push([0, a * PHI, b * t], [a * t, 0, b * PHI], [a * PHI, b * t, 0]);
    const octa = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const tet = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    const g = k === 4 ? { verts: tet, faces: faces(tet, tet.map((v) => v.map((x) => -x))) } : k === 6 ? { verts: cube, faces: faces(cube, octa) }
      : k === 8 ? { verts: octa, faces: faces(octa, cube) } : k === 12 ? { verts: dod, faces: faces(dod, ico) }
      : k === 20 ? { verts: ico, faces: faces(ico, dod) } : trapezohedron();
    const r = Math.max(...g.verts.map((v) => Math.hypot(v[0], v[1], v[2])));
    g.verts = g.verts.map((v) => v.map((x) => x / r));
    for (const f of g.faces) f.c = f.idx.reduce((s, i) => [s[0] + g.verts[i][0] / f.idx.length, s[1] + g.verts[i][1] / f.idx.length, s[2] + g.verts[i][2] / f.idx.length], [0, 0, 0]);
    g.label = LABEL[k];
    return (SOLIDS[k] = g);
  }
  const ownFaces = (sides) => solid(sides).faces.length === sides;
  // the face that shows a value, and what each face says (an unusual die shows only its result)
  function faceOf(sides, value) {
    return ownFaces(sides) ? value - 1 : die(solid(sides).faces.length) - 1;
  }
  const labelOf = (sides, i) => (ownFaces(sides) ? String(i + 1) : '');
  // the page's colours, read through a probe (the custom properties can be hex, rgb() or color-mix())
  const rgbOf = (s) => { const n = (String(s).match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3).map(Number); return /color\(/.test(s) ? n.map((x) => x * 255) : n; };
  const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t));
  const css = (c) => 'rgb(' + c.join(',') + ')';
  function palette() {
    const host = $('#dice') || document.body;
    const read = (name) => { const p = el('span', { hidden: '' }); p.style.color = 'var(' + name + ')'; host.append(p); const c = getComputedStyle(p).color; p.remove(); return rgbOf(c); };
        // a die in solid colour: lit faces a little lighter, faces turned away darker; its number white or near-black,
    // whichever reads on it
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    const tone = (c) => ({ face: mix(c, [255, 255, 255], 0.16), shadow: mix(c, [0, 0, 0], 0.6), ink: lum(c) > 150 ? '#160f1a' : '#ffffff' });
    return { font: getComputedStyle(document.body).fontFamily, plain: tone(read('--accent')), crit: tone(read('--good')), fumble: tone(read('--bad')) };
  }
  const LIGHT = unit([0, 0.3, 0.95]);   // from the front, a little above: the result's face brightest, faces below it darkest
  // draws a die px wide centred on (cx, cy), turned by q; d: { sides, front (a face index), frontLabel, tone }
  // each die's size and middle as it lies at rest, so every die sits centred in its box at one size: its outline spans
  // the same width or height (a d6's square, which fills its box, a little less), its middle on the box's middle
  const FIT = {};
  function fit(sides) {
    const k = shapeFor(sides);
    if (FIT[k]) return FIT[k];
    const g = solid(sides), q = rest(sides, 0), ps = g.verts.map((v) => rot(q, v));
    const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    // a triangle centred by its outline looks low (its weight is in the base): the d4 sits halfway up to its centre
    return (FIT[k] = { scale: (2 / Math.max(x1 - x0, y1 - y0)) * (k === 6 ? 0.7 : 1), dx: -(x0 + x1) / 2, dy: -(y0 + y1) / 2 * (k === 4 ? 0.5 : 1) });
  }
  // where a face's number goes: its middle. On the d4's big triangle the number's own nudge down (see draw) left it
  // below the middle, so it moves a little toward the corner on top at rest (the face's first), back onto it
  function labelAt(g, fc, sides) {
    if (shapeFor(sides) !== 4) return fc.c;
    const top = g.verts[fc.idx[0]];
    return fc.c.map((x, i) => x + (top[i] - x) * 0.06);
  }
  function draw(ctx, cx, cy, px, d, q, pal) {
    const g = solid(d.sides), tone = pal[d.tone || 'plain'], fi = fit(d.sides);
    const R = px * 0.42 * fi.scale, f = 12;   // little perspective, as in a drawn die
    const pt = (v) => { const r = rot(q, v), s = f / (f - r[2]); return [cx + (r[0] * s + fi.dx) * R, cy - (r[1] * s + fi.dy) * R]; };
    const pts = g.verts.map(pt);
    const vis = [];
    g.faces.forEach((fc, i) => { const n = rot(q, fc.n); if (n[2] > 0.01) vis.push([fc, i, n]); });
    vis.sort((a, b) => a[2][2] - b[2][2]);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [fc, i, n] of vis) {
      ctx.beginPath();
      fc.idx.forEach((j, k) => (k ? ctx.lineTo(pts[j][0], pts[j][1]) : ctx.moveTo(pts[j][0], pts[j][1])));
      ctx.closePath();
      const lit = Math.max(0, dot(n, LIGHT));
      ctx.fillStyle = ctx.strokeStyle = css(mix(tone.shadow, tone.face, 0.1 + 0.9 * lit * lit));
      ctx.fill();
      ctx.stroke();
      if (i !== d.front || n[2] < 0.3) continue;
      const label = d.frontLabel !== undefined ? String(d.frontLabel) : labelOf(d.sides, i);
      if (!label) continue;
      // the font at one size per die, scaled as the face turns: a new font size every frame made the browser
      // re-read the font and redraw its letters each time
      const c = pt(labelAt(g, fc, d.sides)), base = Math.round(px * g.label), k = Math.sqrt(n[2]) * (label.length > 2 ? 0.7 : label.length > 1 ? 0.85 : 1);
      ctx.save();
      ctx.globalAlpha = Math.min(1, (n[2] - 0.3) / 0.4);
      ctx.fillStyle = tone.ink;
      ctx.font = '800 ' + base + 'px ' + pal.font;
      ctx.translate(c[0], c[1] + base * k * 0.04);
      ctx.scale(k, k);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
  // a d100 is two d10s, as at the table: the tens (00–90) behind, the ones (0–9) in front. d.pair holds the two, and
  // q is then a pair of turns
  function pairOf(value, tone) {
    const tens = Math.floor((value % 100) / 10), ones = value % 10;
    return { pair: [{ sides: 10, front: tens, frontLabel: tens + '0', tone }, { sides: 10, front: ones, frontLabel: String(ones), tone }] };
  }
  function drawAny(ctx, cx, cy, px, d, q, pal) {
    if (!d.pair) { draw(ctx, cx, cy, px, d, q, pal); return; }
    draw(ctx, cx - px * 0.16, cy - px * 0.14, px * 0.72, d.pair[0], q[0], pal);
    draw(ctx, cx + px * 0.14, cy + px * 0.12, px * 0.72, d.pair[1], q[1], pal);
  }
  // draws a die filling its own canvas
  function paint(cv, d, q, pal) {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    shadow(ctx, cv.width / 2, cv.height / 2, cv.width, 0);
    drawAny(ctx, cv.width / 2, cv.height / 2, cv.width, d, q, pal);
  }
  function canvasFor(cssPx, cls) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cv = el('canvas', { cls: 'die' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    cv.width = cv.height = Math.round(cssPx * dpr);
    cv.style.width = cv.style.height = cssPx + 'px';
    return cv;
  }
  // At rest a die shows its result's face straight at you, upright (a corner on top; a d6 square on its edge); only a d10
  // is tipped back, as its kites run nearly from tip to tip and its lower half would not show.
  const TIP = [1, 0, 0, 0], TIP10 = turn([1, 0, 0], -0.4);
  function rest(sides, front) {
    const g = solid(sides), f = g.faces[front], q = facing(f.n);
    // the face's corner furthest from its middle (the tip of a d10's kite) turned to the top
    let far = f.idx[0], best = -1;
    for (const i of f.idx) { const v = g.verts[i], dd = Math.hypot(v[0] - f.c[0], v[1] - f.c[1], v[2] - f.c[2]); if (dd > best + 1e-6) { best = dd; far = i; } }
    const v = rot(q, g.verts[far]), c = rot(q, f.c);
    const up = Math.PI / 2 - Math.atan2(v[1] - c[1], v[0] - c[0]) + (f.idx.length === 4 && shapeFor(sides) === 6 ? Math.PI / 4 : 0);
    // the d10's kites run nearly from tip to tip, so its lower half only shows when tipped back further
    return mul(shapeFor(sides) === 10 ? TIP10 : TIP, mul(turn([0, 0, 1], up), q));
  }
  // the soft shadow a die casts on the table; lift (0 on the table) moves it out and fades it
  function shadow(ctx, x, y, px, lift) {
    const rx = px * 0.4 * (1 - lift * 0.3), ry = px * 0.11 * (1 - lift * 0.3);
    const cx = x + lift * px * 0.3, cy = y + px * 0.37;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, 'rgba(0, 0, 0, ' + (0.3 * (1 - lift * 0.6)).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, ry / rx); ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, rx, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // the small die in a chip or on the top bar button: an icosahedron seen face-on (projected from solid(20)): the outline,
  // the front face, and the lines from its corners to the outline's
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">'
    + '<path d="M12 2 L20.66 7 V17 L12 22 L3.34 17 V7 Z M12 5.82 L17.35 15.09 H6.65 Z"/>'
    + '<path d="M12 5.82 V2 M12 5.82 L3.34 7 M12 5.82 L20.66 7 M17.35 15.09 L20.66 7 M17.35 15.09 L20.66 17 M17.35 15.09 L12 22 M6.65 15.09 L12 22 M6.65 15.09 L3.34 17 M6.65 15.09 L3.34 7"/></svg>';

  // ---------------------------------------------------------------- the dice screen
  let hist = [], histKey = null, frame = 0;
  async function loadHistory() {
    const key = 'dice:' + (state.charKey || '');
    if (key === histKey) return;
    histKey = key;
    hist = [];
    try { const h = await idbGet(key); if (Array.isArray(h)) hist = h; } catch (e) { /* none kept */ }
    renderHistory();
  }
  function keep(r) {
    hist.unshift({ what: r.spec.what || '', expr: r.expr, total: r.total, sum: breakdown(r), note: note(r), mode: r.spec.mode, at: r.at, spec: r.spec });
    hist.length = Math.min(hist.length, KEEP);
    if (histKey) idbPut(histKey, hist).catch(() => {});
    renderHistory();
  }
  const time = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function renderHistory() {
    const ol = $('#dice-hist');
    if (!ol) return;
    ol.textContent = '';
    $('#dice-hist-clear').hidden = !hist.length;
    if (!hist.length) { ol.append(el('li', { cls: 'note', text: 'No rolls yet.' })); return; }
    hist.forEach((h, i) => {
      const b = el('button', { type: 'button', 'data-again': String(i), 'aria-label': 'Roll again: ' + (h.what || h.expr) }, [
        el('span', { cls: 'dh-what' }, [document.createTextNode(h.what || h.expr), el('span', { cls: 'muted', text: ' ' + time(h.at) })]),
        el('b', { cls: 'dh-total num', text: String(h.total) }),
        el('span', { cls: 'dh-sum hint', text: h.sum + (h.mode !== 'normal' && MODE_NAME[h.mode] ? ', ' + MODE_NAME[h.mode] : '') + (h.note ? ' · ' + h.note : '') }),
      ]);
      ol.append(el('li', {}, [b]));
    });
  }
  // the pads show each die with its highest number in front, in the page's colours (drawn when the screen opens)
  function paintPads() {
    const pal = palette();
    for (const b of document.querySelectorAll('#dice-pads [data-pad]')) {
      const s = Number(b.dataset.pad);
      if (s === 100) paint(b.querySelector('canvas'), pairOf(100), [rest(10, 0), rest(10, 0)], pal);
      else paint(b.querySelector('canvas'), { sides: s, front: s - 1 }, rest(s, s - 1), pal);
    }
  }
  function open() {
    const dlg = $('#dice');
    loadHistory();
    if (!dlg.open) { dlg.showModal(); paintPads(); }
  }
  // roll and show it: the dice are thrown in from below the screen, bounce across it spinning, and land in the tray on
  // their results (half a second), then the total pops up. Each flying die is its own small canvas on a layer over the
  // whole screen (.dice-fly), moved with a transform, so a frame redraws only the dice (a canvas the size of the screen
  // made every frame slow on a tablet); its canvas in the tray shows once it has landed. Dice kept from the last roll
  // (advantage) lie still.
  const FLY_MS = 500;
  // a flying die's canvas, in sizes of the die: room for it lifted and enlarged, and for its shadow below
  const SPRITE_W = 2, SPRITE_H = 2.6, SPRITE_X = 1, SPRITE_Y = 1.9;
  function flyLayer() {
    let c = $('#dice .dice-fly');
    if (!c) { c = el('div', { cls: 'dice-fly', 'aria-hidden': 'true' }); $('#dice').append(c); }
    return c;
  }
  const bezier = (a, b, c, d, u) => [0, 1].map((k) => (1 - u) ** 3 * a[k] + 3 * (1 - u) ** 2 * u * b[k] + 3 * (1 - u) * u * u * c[k] + u ** 3 * d[k]);
  function rollAndShow(spec, fromBuilder) {
    const r = roll(spec);
    if (!r) { U.toast('Nothing to roll there'); return; }
    open();
    if (!fromBuilder && $('#dice-expr').value) { $('#dice-expr').value = ''; padCounts(); }
    keep(r);
    cancelAnimationFrame(frame);
    // back to the top at once, so the tray is where the dice land
    $('#dice .panel-body').scrollTop = 0;
    const tray = $('#dice-tray');
    // the result area keeps its height while the dice fly (the total and breakdown are empty then), so the screen doesn't
    // jump shorter and back; it is let go when the new result is in
    const area = $('#dice .dice-result');
    area.style.minHeight = area.offsetHeight + 'px';
    tray.textContent = '';
    const n = r.groups.reduce((a, g) => a + g.rolls.length, 0);
    const size = n > 30 ? 34 : n > 12 ? 48 : 72;
    const pal = palette();
    const dice = [];
    for (const g of r.groups) g.rolls.forEach((v, i) => {
      const tone = r.d20 && i !== g.drop && v === 20 ? 'crit' : r.d20 && i !== g.drop && v === 1 ? 'fumble' : 'plain';
      const d = g.sides === 100 ? pairOf(v, tone) : { sides: g.sides, front: faceOf(g.sides, v), frontLabel: ownFaces(g.sides) ? undefined : v, tone };
      const still = i < g.kept || reduceMotion();
      const cv = canvasFor(size, i === g.drop ? 'dropped' : '');
      const end = d.pair ? d.pair.map((p) => rest(10, p.front)) : rest(g.sides, d.front);
      tray.append(cv);
      if (still) paint(cv, d, end, pal); else cv.style.visibility = 'hidden';
      // a random axis, three to four turns, slowing to rest
      const axis = () => unit([random() - 0.5, random() - 0.5, random() - 0.5]);
      dice.push({ cv, d, end, still, axis: axis(), axis2: axis(), turns: (3 + random()) * 2 * Math.PI, delay: still ? 0 : Math.min(dice.length, 8) * 25 });
    });
    $('#dice-what').textContent = (spec.what || r.expr) + (r.spec.mode !== 'normal' ? ' · ' + MODE_NAME[r.spec.mode] : '');
    const total = $('#dice-total'), sum = $('#dice-sum'), nt = $('#dice-note');
    const fly = flyLayer();
    fly.textContent = '';
    const settle = () => {
      area.style.minHeight = '';
      fly.textContent = '';
      for (const x of dice) { x.cv.style.visibility = ''; paint(x.cv, x.d, x.end, pal); }
      total.textContent = String(r.total);
      total.classList.remove('pop'); void total.offsetWidth; total.classList.add('pop');
      sum.textContent = breakdown(r);
      nt.textContent = note(r);
      nt.className = 'dice-note' + (r.nat === 20 ? ' good' : r.nat === 1 ? ' bad' : '');
      renderActs(r);
    };
    const moving = dice.filter((x) => !x.still);
    if (!moving.length) { settle(); return; }
    total.textContent = ''; sum.textContent = ''; nt.textContent = '';
    const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(3, window.devicePixelRatio || 1);
    const sw = Math.round(size * SPRITE_W * dpr), sh = Math.round(size * SPRITE_H * dpr);
    // each die: from below the screen, through two random points anywhere on it, to its place in the tray
    for (const x of moving) {
      const b = x.cv.getBoundingClientRect();
      x.to = [b.left + b.width / 2, b.top + b.height / 2];
      x.from = [random() * W, H + size];
      x.p1 = [random() * W, H * (0.15 + 0.6 * random())];
      x.p2 = [random() * W, H * (0.1 + 0.5 * random())];
      x.sprite = el('canvas', {});
      x.sprite.width = sw; x.sprite.height = sh;
      x.sprite.style.width = size * SPRITE_W + 'px'; x.sprite.style.height = size * SPRITE_H + 'px';
      x.sprite.style.visibility = 'hidden';
      x.ctx = x.sprite.getContext('2d');
      x.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fly.append(x.sprite);
    }
    const ox = size * SPRITE_X, oy = size * SPRITE_Y;
    const t0 = performance.now(), last = Math.max(...moving.map((x) => x.delay)) + FLY_MS;
    const step = (now) => {
      const at = now - t0;
      if (at >= last) { settle(); return; }
      for (const x of moving) {
        const t = (at - x.delay) / FLY_MS;
        if (t <= 0 || x.landed) continue;
        if (t >= 1) { x.landed = true; x.sprite.style.visibility = 'hidden'; x.cv.style.visibility = ''; paint(x.cv, x.d, x.end, pal); continue; }
        const u = 1 - (1 - t) ** 2, pos = bezier(x.from, x.p1, x.p2, x.to, u);
        // bounces that die down as it slows; higher = larger and further from its shadow
        const hop = Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) ** 1.5;
        const ctx = x.ctx;
        ctx.clearRect(0, 0, size * SPRITE_W, size * SPRITE_H);
        shadow(ctx, ox, oy, size, hop);
        const a = x.turns * (1 - easeOut(t));
        drawAny(ctx, ox, oy - hop * size * 0.9, size * (1 + 0.45 * hop), x.d, x.d.pair ? [mul(x.end[0], turn(x.axis2, a)), mul(x.end[1], turn(x.axis, a))] : mul(x.end, turn(x.axis, a)), pal);
        x.sprite.style.transform = 'translate3d(' + (pos[0] - ox).toFixed(1) + 'px,' + (pos[1] - oy).toFixed(1) + 'px,0)';
        x.sprite.style.visibility = '';
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }
  // what to do next: advantage or not (a d20), the attack's damage, the same again (quiet buttons: the roll is what counts)
  function renderActs(r) {
    const box = $('#dice-acts');
    box.textContent = '';
    const btn = (text, spec, cls) => { const b = el('button', { cls: 'btn sm' + (cls ? ' ' + cls : ''), type: 'button', text }); b.addEventListener('click', () => rollAndShow(spec)); return b; };
    const s = r.spec;
    if (r.d20) {
      const seg = el('div', { cls: 'seg', role: 'group', 'aria-label': 'Roll with' });
      for (const [m, t] of [['normal', 'Normal'], ['adv', 'Advantage'], ['dis', 'Disadvantage']]) {
        // switching keeps the d20 already rolled (the same mode again rolls anew)
        const b = el('button', { type: 'button', 'aria-pressed': s.mode === m ? 'true' : 'false', text: t });
        b.addEventListener('click', () => rollAndShow(m === s.mode ? fresh(s) : Object.assign({}, s, { mode: m, prev: r.groups[0].rolls })));
        seg.append(b);
      }
      box.append(seg);
    }
    if (s.kind === 'attack' && s.damage) box.append(btn('Roll damage', s.damage, 'primary'));
    box.append(btn('Roll again', fresh(s)));
  }

  // the builder: a tap on a die adds one to the box; − and + change the number; the box can be typed in too
  function addDie(sides) {
    const box = $('#dice-expr');
    const p = parse(box.value) || { dice: [], mod: 0 };
    const d = p.dice.filter((x) => x.sides === sides && x.sign > 0)[0];
    if (d) d.n++; else p.dice.push({ n: 1, sides, sign: 1 });
    box.value = format(p);
    padCounts();
  }
  function addMod(by) {
    const box = $('#dice-expr');
    const p = parse(box.value) || { dice: [], mod: 0 };
    p.mod += by;
    box.value = p.dice.length || p.mod ? format(p) : '';
    padCounts();
  }
  function padCounts() {
    const p = parse($('#dice-expr').value);
    for (const b of document.querySelectorAll('#dice-pads [data-pad]')) {
      const n = p ? p.dice.filter((d) => d.sides === Number(b.dataset.pad)).reduce((a, d) => a + d.n, 0) : 0;
      const c = b.querySelector('.cnt');
      c.textContent = n ? '×' + n : '';
      c.hidden = !n;
    }
  }
  function buildPads() {
    const pads = $('#dice-pads');
    pads.textContent = '';
    for (const s of PADS) {
      const b = el('button', { cls: 'pad', type: 'button', 'data-pad': String(s), 'aria-label': 'Add a d' + s }, [canvasFor(52), el('span', { cls: 'pad-k', text: 'd' + s }), el('span', { cls: 'cnt', hidden: '' })]);
      b.addEventListener('click', () => addDie(s));
      pads.append(b);
    }
  }

  // ---------------------------------------------------------------- rolls on the sheet
  // data-roll on a button: "d20" (its text is a bonus: d20 + it), "dice" (its text, or data-expr, is dice to roll),
  // "hd" (a hit die: data-die and data-mod name MPMB's fields), "death" (a death saving throw).
  // data-kind: what it is (attack, save, check, init); data-what names it; data-adv: MPMB's advantage box for it
  // (its disadvantage box has "Dis" for "Adv"), ticked on the sheet = rolled with advantage.
  const v = (name) => U.shown(state.snap.get(name)).trim();
  const isBonus = (t) => /^[+-]?\d+$/.test(String(t).replace(/[−–]/g, '-').replace(/\s+/g, ''));
  const rollable = (b) => {
    const k = b.dataset.roll, t = b.dataset.expr || b.textContent;
    return k === 'd20' ? isBonus(t) : k === 'dice' ? !!(parse(t) && parse(t).dice.length) : true;
  };
  // after a value changes (apply in app.js): a number that can't be rolled (empty, "DC 13") is plain text
  function markRoll(b) { b.disabled = !rollable(b); }
  function place(b) {
    const band = b.closest('.band');
    return band && band.id === 'companion' ? 'Companion · ' : band && band.id === 'wildshape' ? 'Wild Shape · ' : '';
  }
  // what a roll is of: the attack, item, feature or spell it sits in
  function whatFor(b) {
    const atk = b.closest('.attack');
    if (atk) { const i = atk.querySelector('input[data-f$="Weapon Selection"]'), o = atk.querySelector('[data-out$=".Weapon"]'); return (i && i.value) || (o && o.textContent) || 'Attack'; }
    const tool = b.closest('.skill.tool');
    if (tool) return tool.querySelector('input').value || 'Tool';
    const mi = b.closest('.mi');
    if (mi) return mi.querySelector('input[data-f]').value || 'Magic item';
    const feat = b.closest('details.feat');
    if (feat) { const n = feat.querySelector('summary .fname') || feat.querySelector('summary'); return n.textContent.trim(); }
    const sp = b.closest('li.spell, li.pk');
    if (sp) return (sp.querySelector('.sp-name, .pk-name') || sp).textContent.trim();
    if (b.closest('#spell-info')) return $('#si-title').textContent;
    return '';
  }
  function specFor(b) {
    const k = b.dataset.roll, kind = b.dataset.kind || '';
    const what = place(b) + (b.dataset.what || whatFor(b));
    if (k === 'd20') {
      const n = Number(String(b.textContent).replace(/[−–]/g, '-').replace(/\s+/g, ''));
      let mode = 'normal';
      if (b.dataset.adv) {
        const adv = state.snap.get(b.dataset.adv), dis = state.snap.get(b.dataset.adv.replace(/Adv$/, 'Dis'));
        const a = !!(adv && adv.checked), d = !!(dis && dis.checked);
        mode = a && !d ? 'adv' : d && !a ? 'dis' : 'normal';
      }
      const spec = { expr: '1d20' + bonus(n), what: kind === 'attack' ? what + ' · to hit' : what, kind, mode };
      if (kind === 'attack') {
        const dmg = b.closest('.attack').querySelector('[data-roll="dice"][data-kind="damage"]');
        if (dmg && rollable(dmg)) spec.damage = specFor(dmg);
      }
      return spec;
    }
    if (k === 'dice') {
      let w = what;
      if (kind === 'damage') { const t = b.closest('.attack').querySelector('[data-out$="Damage Type"]'); w += ' · damage' + (t && t.textContent.trim() ? ', ' + t.textContent.trim().toLowerCase() : ''); }
      return { expr: b.dataset.expr || b.textContent, what: w, kind };
    }
    if (k === 'hd') {
      const d = v(b.dataset.die).replace(/^d/i, ''), m = Number(v(b.dataset.mod)) || 0;
      if (!/^\d+$/.test(d)) return null;
      return { expr: '1d' + d + (m ? bonus(m) : ''), what: place(b) + 'Hit die (d' + d + ')', kind: 'hd' };
    }
    if (k === 'death') return { expr: '1d20', what: place(b) + 'Death saving throw', kind: 'death' };
    return null;
  }

  // dice written in a text ("2d6 Fire dmg", "1d4+1") become chips that roll them
  const DICE_IN_TEXT = /(^|[^A-Za-z0-9])(\d{0,3}d(?:\d{1,3}|%)(?:\s?[+−-]\s?\d{1,3})?)(?![A-Za-z0-9])/g;
  function diceText(node) {
    if (!node) return;
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.parentElement.closest('button, input, textarea, select, .dice-chip') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const texts = [];
    for (let t = walk.nextNode(); t; t = walk.nextNode()) if (/\d*d(\d|%)/.test(t.data)) texts.push(t);
    for (const t of texts) {
      const s = t.data, frag = document.createDocumentFragment();
      let at = 0, any = false;
      for (const m of s.matchAll(DICE_IN_TEXT)) {
        const start = m.index + m[1].length, expr = m[2];
        const p = parse(expr);
        if (!p || !p.dice.length) continue;
        any = true;
        frag.append(document.createTextNode(s.slice(at, start)));
        const b = el('button', { cls: 'dice-chip', type: 'button', 'data-roll': 'dice', 'data-expr': expr, 'aria-label': 'Roll ' + expr });
        b.innerHTML = ICON;
        b.append(document.createTextNode(expr));
        frag.append(b);
        at = start + expr.length;
      }
      if (!any) continue;
      frag.append(document.createTextNode(s.slice(at)));
      t.replaceWith(frag);
    }
  }

  function wireDice() {
    const dlg = $('#dice');
    $('#dice-open').innerHTML = ICON.replace('<svg ', '<svg width="22" height="22" ');
    $('#dice-open').addEventListener('click', open);
    $('#dice-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { cancelAnimationFrame(frame); const f = $('#dice .dice-fly'); if (f) f.textContent = ''; });
    buildPads();
    $('#dice-expr').addEventListener('input', padCounts);
    $('#dice-expr').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#dice-roll').click(); } });
    $('#dice-minus').addEventListener('click', () => addMod(-1));
    $('#dice-plus').addEventListener('click', () => addMod(1));
    $('#dice-clear').addEventListener('click', () => { $('#dice-expr').value = ''; padCounts(); });
    $('#dice-roll').addEventListener('click', () => {
      const t = $('#dice-expr').value;
      if (!t.trim()) { addDie(20); }
      const p = parse($('#dice-expr').value);
      if (!p) { U.toast('Couldn’t read that: try 2d6 + 3'); return; }
      rollAndShow({ expr: $('#dice-expr').value, what: '', kind: '' }, true);
    });
    $('#dice-hist').addEventListener('click', (e) => { const b = e.target.closest('[data-again]'); if (b && hist[b.dataset.again]) rollAndShow(fresh(hist[b.dataset.again].spec)); });
    $('#dice-hist-clear').addEventListener('click', () => { hist = []; if (histKey) idbPut(histKey, hist).catch(() => {}); renderHistory(); });
    // a tap on a number or dice anywhere on the sheet rolls it (inside a fold's heading too, without folding it)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-roll]');
      if (!b || b.disabled || dlg.contains(b)) return;
      e.preventDefault();
      const spec = specFor(b);
      if (spec) rollAndShow(spec); else U.toast('Nothing to roll there');
    });
    renderHistory();
    padCounts();
  }

  Object.assign(U, { wireDice, diceText, markRoll, parseDice: parse });
})();
