/* Quillbound Sheets — the quick bar above the tab bar: hit points (with temporary ones), armor class and initiative,
 * always on screen, plus what the user pins to it per character: limited features (Focus Points, Channel Divinity…),
 * spell slots per level and Inspiration. A tap on the hit points opens a small panel to take damage, heal or set
 * temporary hit points (#hp-quick); damage takes temporary hit points first, healing stops at the maximum. A tap on a
 * pin opens #pin-quick: Use one / Get one back (never spent by the tap itself). + (and Settings → Quick bar) opens
 * #pins-panel to choose the pins. Initiative rolls (ui-dice.js); armor class goes to the Defense card. The bar can be
 * switched off on this device (localStorage mpmb-vitals = off). Shares helpers and state through window.MPMBUI. */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, $$, el, state } = U;

  const txt = (name) => { const s = state.snap.get(name); return s && s.exists ? String(U.shown(s)).trim() : ''; };
  const num = (name) => { const v = txt(name).replace(/,/g, ''); return v === '' || isNaN(Number(v)) ? null : Number(v); };
  // an empty current box is a character at full health (the sheet leaves it empty until it is used)
  const current = () => { const c = num('HP Current'), m = num('HP Max'); return c === null ? m : c; };

  // ---------------------------------------------------------------- on or off (this device)
  const isOn = () => { try { return localStorage.getItem('mpmb-vitals') !== 'off'; } catch (e) { return true; } };
  function setOn(on) {
    try { if (on) localStorage.removeItem('mpmb-vitals'); else localStorage.setItem('mpmb-vitals', 'off'); } catch (e) { /* this visit only */ }
    showOn(on);
  }
  function showOn(on) {
    document.documentElement.classList.toggle('no-vitals', !on);
    const b = $('#qb-toggle');
    if (b) { b.textContent = on ? 'On' : 'Off'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  }

  // ---------------------------------------------------------------- pins: what they are and how many are left
  const pins = () => (state.view && Array.isArray(state.view.pins) ? state.view.pins : []);
  const pinKey = (p) => p.kind + ':' + (p.kind === 'lf' ? p.name : p.kind === 'slot' ? p.level : '');
  // a long name made short enough for a chip: "Channel Divinity" → "Channel Div."
  function shortName(n) {
    n = String(n).replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (n.length <= 12) return n;
    const w = n.split(' ');
    let out = w[0];
    for (let i = 1; i < w.length && out.length < 10; i++) out += ' ' + (w[i].length > 4 ? w[i].slice(0, 3) + '.' : w[i]);
    return out.length > 14 ? out.slice(0, 12) + '…' : out;
  }
  // the sheet's limited feature lines: line number by name (the sheet reorders them, so pins go by name)
  function limitedLines() {
    const out = [];
    for (let i = 1; i <= U.rows('limited', U.LIMITED); i++) { const name = txt('Limited Feature ' + i); if (name) out.push({ i, name }); }
    return out;
  }
  const slotLevels = () => { const out = []; for (let l = 1; l <= 9; l++) if ((num('SpellSlots.CheckboxesSet.lvl' + l) || 0) > 0) out.push(l); return out; };
  const slotPips = (l) => $$('[data-slots="' + l + '"] [data-toggle]').filter((b) => !b.hidden);
  const inspCounter = () => !!(state.view && state.view.inspCount);
  // what a pin shows and does now; null when the character doesn't have it (now): its chip is left out
  function about(p) {
    if (p.kind === 'lf') {
      const line = limitedLines().filter((x) => x.name === p.name)[0];
      if (!line) return null;
      const i = line.i, used = num('Limited Feature Used ' + i) || 0, max = num('Limited Feature Max Usages ' + i);
      const set = (n) => U.send('commit', { name: 'Limited Feature Used ' + i, value: n > 0 ? String(n) : '' });
      return {
        title: p.name, label: shortName(p.name), left: max === null ? null : max - used, max, used,
        hint: txt('Limited Feature Recovery ' + i), unit: 'use',
        use: max === null || used < max ? () => set(used + 1) : null,
        back: used > 0 ? () => set(used - 1) : null,
        go: () => goToCard($('#limited'), 'features'),
      };
    }
    if (p.kind === 'slot') {
      const l = p.level, n = num('SpellSlots.CheckboxesSet.lvl' + l) || 0;
      if (n <= 0) return null;
      const pips = slotPips(l), used = pips.filter((b) => b.getAttribute('aria-pressed') === 'true').length;
      const free = pips.filter((b) => b.getAttribute('aria-pressed') !== 'true');
      const done = pips.filter((b) => b.getAttribute('aria-pressed') === 'true');
      return {
        title: U.LEVEL_NAMES[l] + ' spell slots', label: 'Lvl ' + l, left: n - used, max: n, used, hint: 'Back on a long rest.', unit: 'slot',
        use: free.length && n - used > 0 ? () => free[0].click() : null,
        back: done.length ? () => done[done.length - 1].click() : null,
        go: () => goToCard($('#slots'), 'spells'),
      };
    }
    if (p.kind === 'insp') {
      const checked = !!(state.snap.get('Inspiration') || {}).checked;
      if (!(state.snap.get('Inspiration') || {}).exists) return null;
      const counter = inspCounter(), n = counter ? (U.inspiration ? U.inspiration.count() : 0) : checked ? 1 : 0;
      const toggle = () => U.send('toggle', { name: 'Inspiration' });
      return {
        title: 'Heroic Inspiration', label: 'Insp', left: n, max: counter ? null : 1, used: 0, unit: 'point',
        hint: counter ? 'Inspiration points (Sheet → House rules).' : 'Spend it to reroll a die.',
        use: n > 0 ? () => (counter ? U.inspiration.step(-1) : toggle()) : null,
        back: counter || !checked ? () => (counter ? U.inspiration.step(1) : toggle()) : null,
        go: () => goToCard($('#insp-dot'), 'main'),
      };
    }
    return null;
  }
  // every pinnable thing this character has now (for the chooser)
  function pinnable() {
    const out = [];
    for (const x of limitedLines()) out.push({ kind: 'lf', name: x.name, group: 'Limited features', text: x.name });
    for (const l of slotLevels()) out.push({ kind: 'slot', level: l, group: 'Spell slots', text: U.LEVEL_NAMES[l] });
    if ((state.snap.get('Inspiration') || {}).exists) out.push({ kind: 'insp', group: 'Inspiration', text: 'Heroic Inspiration' });
    return out;
  }

  // ---------------------------------------------------------------- the bar
  function refresh() {
    if (!$('#vt-hp')) return;
    const cur = num('HP Current'), max = num('HP Max'), temp = num('HP Temp') || 0;
    const shownCur = cur === null ? max : cur;
    $('#vt-hp-cur').textContent = shownCur === null ? '–' : String(shownCur);
    $('#vt-hp-max').textContent = max === null ? '' : '/' + max;
    $('#vt-hp-temp').textContent = temp ? '+' + temp : '';
    $('#vt-hp-temp').hidden = !temp;
    const b = $('#vt-hp');
    b.dataset.state = shownCur === null ? '' : shownCur <= 0 ? 'down' : max && shownCur <= max / 2 ? 'low' : '';
    b.setAttribute('aria-label', 'Hit points: ' + (shownCur === null ? 'not set' : shownCur + (max !== null ? ' of ' + max : '')) + (temp ? ', ' + temp + ' temporary' : '') + '. Tap to change.');
    drawPins();
    if ($('#hp-quick').open) fillHp();
    if ($('#pin-quick').open) fillPin();
  }
  function drawPins() {
    const box = $('#vt-pins');
    const want = pins().map((p) => ({ p, a: about(p) })).filter((x) => x.a);
    const sig = JSON.stringify(want.map((x) => [pinKey(x.p), x.a.label, x.a.left, x.a.max]));
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.textContent = '';
    for (const { p, a } of want) {
      const n = a.left === null ? String(a.used) : String(a.left);
      box.append(el('button', { cls: 'vt vt-pin', type: 'button', 'data-pin': pinKey(p), 'data-empty': a.left === 0 ? '1' : '', 'aria-haspopup': 'dialog',
        'aria-label': a.title + ': ' + (a.left === null ? a.used + ' used' : a.left + (a.max !== null ? ' of ' + a.max : '') + ' left') + '. Tap to use.' },
      [el('span', { cls: 'vt-k', text: a.label }), el('b', { cls: 'num', text: n }), a.max !== null && p.kind !== 'insp' ? el('span', { cls: 'vt-max num', text: '/' + a.max }) : el('span')]));
    }
  }
  function goToCard(n, band) {
    const card = n && n.closest('.card');
    U.goTo(band);
    if (card) {
      if (card.classList.contains('folded') || card.classList.contains('user-hidden')) U.peekCard(card);
      setTimeout(() => card.scrollIntoView({ behavior: U.reduceMotion() ? 'auto' : 'smooth', block: 'center' }), 60);
    }
  }

  // ---------------------------------------------------------------- hit points panel
  function fillHp() {
    const cur = current(), max = num('HP Max'), temp = num('HP Temp') || 0;
    $('#hq-now').textContent = cur === null ? '–' : String(cur);
    $('#hq-max').textContent = max === null ? '' : ' / ' + max;
    $('#hq-temp').textContent = temp ? temp + ' temporary' : 'No temporary hit points';
    $('#hq-down').hidden = !(cur !== null && cur <= 0);
  }
  const amount = () => { const n = Math.floor(Number(String($('#hq-amount').value).trim())); return n > 0 ? n : 0; };
  async function commit(name, value) { await U.send('commit', { name, value: String(value) }); }
  async function damage(n) {
    const temp = num('HP Temp') || 0, cur = current() || 0;
    const fromTemp = Math.min(temp, n);
    if (fromTemp) await commit('HP Temp', temp - fromTemp ? temp - fromTemp : '');
    if (n - fromTemp) await commit('HP Current', Math.max(0, cur - (n - fromTemp)));
    hpDone('Took ' + n + ' damage' + (fromTemp ? ' (' + fromTemp + ' from temporary)' : '') + '.');
  }
  async function heal(n) {
    const max = num('HP Max'), cur = current() || 0;
    await commit('HP Current', max === null ? cur + n : Math.min(max, cur + n));
    hpDone('Healed ' + n + '.');
  }
  async function setTemp(n) { await commit('HP Temp', n || ''); hpDone(n ? 'Temporary hit points: ' + n + '.' : 'Temporary hit points cleared.'); }
  function hpDone(what) {
    $('#hq-amount').value = '';
    $('#hq-last').textContent = what;
    fillHp();
  }

  // ---------------------------------------------------------------- a pin's panel
  let openPin = null;
  function fillPin() {
    const a = openPin && about(openPin);
    if (!a) { $('#pin-quick').close(); return; }
    $('#pq-title').textContent = a.title;
    $('#pq-now').textContent = a.left === null ? String(a.used) : String(a.left);
    $('#pq-max').textContent = a.left === null ? ' used' : a.max !== null && openPin.kind !== 'insp' ? ' / ' + a.max + ' left' : a.left === 1 ? ' ' + a.unit : ' ' + a.unit + 's';
    $('#pq-hint').textContent = a.hint || '';
    $('#pq-use').disabled = !a.use;
    $('#pq-back').disabled = !a.back;
    $('#pq-use').textContent = openPin.kind === 'insp' ? 'Spend it' : 'Use one';
  }
  async function pinAct(which, msg) {
    const a = openPin && about(openPin);
    if (!a || !a[which]) return;
    await a[which]();
    $('#pq-last').textContent = msg;
    refresh();
  }

  // ---------------------------------------------------------------- choosing the pins
  function renderChooser() {
    const box = $('#pins-list');
    box.textContent = '';
    const have = new Set(pins().map(pinKey));
    const all = pinnable();
    // pinned things the character doesn't have now (a feature lost in a level change): still listed, to unpin
    for (const p of pins()) if (!all.some((x) => pinKey(x) === pinKey(p))) all.push(Object.assign({ group: 'Not on this character now', text: p.name || (p.kind === 'slot' ? U.LEVEL_NAMES[p.level] : 'Heroic Inspiration') }, p));
    let group = null, ul = null;
    for (const x of all) {
      if (x.group !== group) { group = x.group; box.append(el('h4', { cls: 'pins-group', text: group })); ul = el('ul', { cls: 'list' }); box.append(ul); }
      const on = have.has(pinKey(x));
      const b = el('button', { cls: 'btn sm', type: 'button', 'aria-pressed': on ? 'true' : 'false', text: on ? 'On the bar' : 'Add', 'aria-label': (on ? 'Remove ' : 'Add ') + x.text + (on ? ' from' : ' to') + ' the quick bar' });
      b.addEventListener('click', () => togglePin(x));
      ul.append(el('li', {}, [el('span', { cls: 'grow', text: x.text }), b]));
    }
    if (!all.length) box.append(el('p', { cls: 'note', text: 'Nothing to add yet. Limited features, spell slots and Inspiration show up here once your character has them.' }));
  }
  async function togglePin(x) {
    if (!state.charKey) return;
    const k = pinKey(x), list = pins().slice();
    const at = list.findIndex((p) => pinKey(p) === k);
    if (at >= 0) list.splice(at, 1);
    else list.push(x.kind === 'lf' ? { kind: 'lf', name: x.name } : x.kind === 'slot' ? { kind: 'slot', level: x.level } : { kind: 'insp' });
    state.view.pins = list;
    renderChooser();
    refresh();
    await U.idbPut('view:' + state.charKey, state.view);
  }
  function openChooser() {
    if (!state.worker || !state.charKey) { U.toast('Open a character first.'); return; }
    renderChooser();
    $('#pins-panel').showModal();
  }

  // the bar's right part scrolls sideways: by touch, and on a computer by the mouse wheel and by dragging with the
  // mouse (a phone's swipe already works; a wheel only scrolls up and down by itself). Faded edges show there's more.
  // A chip focused with Tab scrolls into view on its own.
  function wireScroll(box) {
    const edges = () => {
      const max = box.scrollWidth - box.clientWidth;
      box.classList.toggle('more-left', box.scrollLeft > 2);
      box.classList.toggle('more-right', max - box.scrollLeft > 2);
    };
    box.addEventListener('scroll', edges, { passive: true });
    new ResizeObserver(edges).observe(box);
    new MutationObserver(edges).observe(box, { childList: true, subtree: true });
    box.addEventListener('wheel', (e) => {
      if (box.scrollWidth <= box.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const before = box.scrollLeft;
      box.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (box.scrollLeft !== before) e.preventDefault();   // at an end, the page scrolls as usual
    }, { passive: false });
    let drag = null;
    box.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0) drag = { x: e.clientX, left: box.scrollLeft, moved: false }; });
    // a drag past the end must not start selecting the page's text or drag a chip away
    box.addEventListener('dragstart', (e) => e.preventDefault());
    document.addEventListener('selectstart', (e) => { if (drag) e.preventDefault(); });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 5) drag.moved = true;
      if (drag.moved) box.scrollLeft = drag.left - dx;
    });
    window.addEventListener('pointerup', () => { if (drag && drag.moved) { const stop = (e) => { e.stopPropagation(); e.preventDefault(); }; box.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => box.removeEventListener('click', stop, { capture: true }), 0); } drag = null; });
    edges();
  }

  function wireVitals() {
    showOn(isOn());
    // the bar's numbers are bound to the sheet's fields; redraw it whenever one of them is filled in (and after every
    // change: refreshDerived calls refreshVitals)
    new MutationObserver(refresh).observe($('#vitals-src'), { childList: true, subtree: true, characterData: true });
    $('#vt-hp').addEventListener('click', () => {
      if (!state.worker) return;
      $('#hq-last').textContent = '';
      $('#hq-amount').value = '';
      fillHp();
      $('#hp-quick').showModal();
    });
    $('#vt-ac').addEventListener('click', () => goToCard($('#f-armor'), 'combat'));
    const act = (fn) => async () => { const n = amount(); if (!n) { $('#hq-amount').focus(); return; } await fn(n); };
    $('#hq-damage').addEventListener('click', act(damage));
    $('#hq-heal').addEventListener('click', act(heal));
    $('#hq-settemp').addEventListener('click', () => setTemp(amount()));
    for (const b of $$('#hp-quick [data-hq]')) b.addEventListener('click', () => { const by = Number(b.dataset.hq); if (by < 0) damage(-by); else heal(by); });
    $('#hq-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); act(damage)(); } });
    $('#hq-close').addEventListener('click', () => $('#hp-quick').close());
    $('#hq-card').addEventListener('click', () => { $('#hp-quick').close(); goToCard($('#f-hp'), 'combat'); });
    // pins
    $('#vt-pins').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pin]');
      if (!b || !state.worker) return;
      openPin = pins().filter((p) => pinKey(p) === b.dataset.pin)[0] || null;
      if (!openPin) return;
      $('#pq-last').textContent = '';
      fillPin();
      $('#pin-quick').showModal();
    });
    $('#pq-use').addEventListener('click', () => pinAct('use', openPin && openPin.kind === 'insp' ? 'Spent.' : 'Used one.'));
    $('#pq-back').addEventListener('click', () => pinAct('back', 'Got one back.'));
    $('#pq-close').addEventListener('click', () => $('#pin-quick').close());
    $('#pq-go').addEventListener('click', () => { const a = openPin && about(openPin); $('#pin-quick').close(); if (a) a.go(); });
    $('#pq-unpin').addEventListener('click', async () => { $('#pin-quick').close(); if (openPin) await togglePin(openPin); });
    wireScroll($('#vitals .vt-more'));
    $('#vt-add').addEventListener('click', openChooser);
    $('#qb-choose').addEventListener('click', openChooser);
    $('#pins-close').addEventListener('click', () => $('#pins-panel').close());
    $('#qb-toggle').addEventListener('click', () => setOn(!isOn()));
    refresh();
  }

  Object.assign(U, { wireVitals, refreshVitals: refresh });
})();
