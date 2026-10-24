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
  const SVGNS = 'http://www.w3.org/2000/svg';

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
  const bonus = (n) => (n < 0 ? '−' : '+') + Math.abs(n);
  // spec: { expr, what, kind, mode ('normal' | 'adv' | 'dis'), crit, damage (an attack's damage spec) }
  // advantage takes the higher of two d20s (disadvantage the lower) for a roll with one d20; a critical rolls the dice twice
  function roll(spec) {
    const p = parse(spec.expr);
    if (!p) return null;
    const d20 = p.dice.length === 1 && p.dice[0].n === 1 && p.dice[0].sides === 20;
    const mode = d20 ? spec.mode || 'normal' : 'normal';
    const groups = p.dice.map((d) => {
      const n = d.n * (spec.crit ? 2 : 1);
      const rolls = [];
      for (let i = 0; i < (mode === 'normal' ? n : 2); i++) rolls.push(die(d.sides));
      let drop = -1;
      if (mode !== 'normal') drop = (mode === 'adv') === (rolls[0] < rolls[1]) ? 0 : 1;
      return { sides: d.sides, sign: d.sign, rolls, drop };
    });
    let total = p.mod;
    for (const g of groups) g.rolls.forEach((r, i) => { if (i !== g.drop) total += g.sign * r; });
    const nat = d20 ? groups[0].rolls[groups[0].drop === 0 ? 1 : 0] : null;
    return { spec: Object.assign({}, spec, { mode }), expr: format(spec.crit ? { dice: p.dice.map((d) => Object.assign({}, d, { n: d.n * 2 })), mod: p.mod } : p), d20, groups, mod: p.mod, total, nat, at: Date.now() };
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

  // ---------------------------------------------------------------- drawing dice
  // flat outlines, one per die size (d100 a circle); the d20 as in the app's icon
  const SHAPES = {
    4: ['M50 8 L94 88 L6 88 Z', 64],
    6: ['M14 14 H86 V86 H14 Z', 58],
    8: ['M50 4 L94 50 L50 96 L6 50 Z', 58],
    10: ['M50 4 L94 44 L50 96 L6 44 Z', 56],
    12: ['M50 5 L95 38 L78 92 L22 92 L5 38 Z', 60],
    20: ['M50 4 L92 28 L92 72 L50 96 L8 72 L8 28 Z', 56],
  };
  function dieSvg(sides, value, cls) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'die' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
    const s = SHAPES[sides];
    if (s) add('path', { d: s[0], class: 'face' });
    else add('circle', { cx: 50, cy: 50, r: 44, class: 'face' });
    if (sides === 20) add('path', { d: 'M50 17 L85 73 L15 73 Z', class: 'edge' });
    const t = add('text', { x: 50, y: s ? s[1] : 56, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'val' });
    t.textContent = value;
    if (String(value).length > 2) t.setAttribute('class', 'val long');
    return svg;
  }
  // the small die in a chip or on the top bar button
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.5 L20.5 7.25 V16.75 L12 21.5 L3.5 16.75 V7.25 Z"/><path d="M12 7 L16.5 15 H7.5 Z M12 2.5 V7 M3.5 7.25 L12 7 L20.5 7.25 M3.5 16.75 L7.5 15 M20.5 16.75 L16.5 15 M12 21.5 L7.5 15 M12 21.5 L16.5 15"/></svg>';

  // ---------------------------------------------------------------- the dice screen
  let last = null, hist = [], histKey = null, timer = 0;
  async function loadHistory() {
    const key = 'dice:' + (state.charKey || '');
    if (key === histKey) return;
    histKey = key;
    hist = [];
    try { const h = await idbGet(key); if (Array.isArray(h)) hist = h; } catch (e) { /* none kept */ }
    renderHistory();
  }
  function keep(r) {
    hist.unshift({ what: r.spec.what || '', expr: r.expr, total: r.total, sum: breakdown(r) + (r.spec.crit ? ', critical' : ''), note: note(r), mode: r.spec.mode, at: r.at, spec: r.spec });
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
  function open() {
    const dlg = $('#dice');
    loadHistory();
    if (!dlg.open) dlg.showModal();
  }
  // roll and show it: the dice tumble in, their faces flicker, then settle and the total pops up
  function rollAndShow(spec) {
    const r = roll(spec);
    if (!r) { U.toast('Nothing to roll there'); return; }
    open();
    last = r;
    keep(r);
    clearInterval(timer);
    const tray = $('#dice-tray');
    tray.textContent = '';
    const n = r.groups.reduce((a, g) => a + g.rolls.length, 0);
    tray.className = 'dice-tray' + (n > 30 ? ' tiny' : n > 12 ? ' small' : '');
    const dice = [];
    for (const g of r.groups) g.rolls.forEach((v, i) => {
      const cls = [i === g.drop ? 'dropped' : '', r.d20 && i !== g.drop && v === 20 ? 'crit' : '', r.d20 && i !== g.drop && v === 1 ? 'fumble' : ''].filter(Boolean).join(' ');
      const s = dieSvg(g.sides, v, cls);
      s.style.setProperty('--r', (die(2) === 1 ? -1 : 1) * (200 + die(300)) + 'deg');
      s.style.setProperty('--dx', (die(81) - 41) + 'px');
      s.style.animationDelay = Math.min(dice.length, 12) * 35 + 'ms';
      tray.append(s);
      dice.push([s, g.sides, v]);
    });
    $('#dice-what').textContent = (spec.what || r.expr) + (r.spec.mode !== 'normal' ? ' · ' + MODE_NAME[r.spec.mode] : '') + (spec.crit ? ' · critical' : '');
    const total = $('#dice-total'), sum = $('#dice-sum'), nt = $('#dice-note');
    const settle = () => {
      clearInterval(timer);
      for (const [s, , v] of dice) { s.classList.remove('spin'); s.querySelector('text').textContent = v; }
      total.textContent = String(r.total);
      total.classList.remove('pop'); void total.offsetWidth; total.classList.add('pop');
      sum.textContent = breakdown(r);
      const t = note(r);
      nt.textContent = t;
      nt.className = 'dice-note' + (r.nat === 20 ? ' good' : r.nat === 1 ? ' bad' : '');
      renderActs(r);
    };
    if (reduceMotion()) { settle(); return; }
    total.textContent = ''; sum.textContent = ''; nt.textContent = ''; $('#dice-acts').textContent = '';
    for (const [s] of dice) s.classList.add('spin');
    const until = Date.now() + 650;
    timer = setInterval(() => {
      if (Date.now() >= until) { settle(); return; }
      for (const [s, sides] of dice) s.querySelector('text').textContent = die(sides);
    }, 70);
  }
  // what to do next: advantage or not (a d20), the attack's damage (normal or critical), a critical, the same again
  function renderActs(r) {
    const box = $('#dice-acts');
    box.textContent = '';
    const btn = (text, spec, cls) => { const b = el('button', { cls: 'btn' + (cls ? ' ' + cls : ''), type: 'button', text }); b.addEventListener('click', () => rollAndShow(spec)); return b; };
    const s = r.spec;
    if (r.d20) {
      const seg = el('div', { cls: 'seg', role: 'group', 'aria-label': 'Roll with' });
      for (const [m, t] of [['normal', 'Normal'], ['adv', 'Advantage'], ['dis', 'Disadvantage']]) {
        const b = el('button', { type: 'button', 'aria-pressed': s.mode === m ? 'true' : 'false', text: t });
        b.addEventListener('click', () => rollAndShow(Object.assign({}, s, { mode: m })));
        seg.append(b);
      }
      box.append(seg);
    }
    if (s.kind === 'attack' && s.damage) {
      box.append(btn('Damage', s.damage, r.nat === 20 ? '' : 'primary'), btn('Critical damage', Object.assign({}, s.damage, { crit: true }), r.nat === 20 ? 'primary' : ''));
    } else if (!r.d20 && r.groups.length) {
      box.append(btn(s.crit ? 'Not critical' : 'Critical', Object.assign({}, s, { crit: !s.crit })));
    }
    box.append(btn('Roll again', s, s.kind === 'attack' && s.damage ? '' : 'primary'));
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
      const b = el('button', { cls: 'pad', type: 'button', 'data-pad': String(s), 'aria-label': 'Add a d' + s }, [dieSvg(s, s === 100 ? '%' : s), el('span', { cls: 'pad-k', text: 'd' + (s === 100 ? '100' : s) }), el('span', { cls: 'cnt', hidden: '' })]);
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
    dlg.addEventListener('close', () => clearInterval(timer));
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
      rollAndShow({ expr: $('#dice-expr').value, what: '', kind: '' });
    });
    $('#dice-hist').addEventListener('click', (e) => { const b = e.target.closest('[data-again]'); if (b && hist[b.dataset.again]) rollAndShow(hist[b.dataset.again].spec); });
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
