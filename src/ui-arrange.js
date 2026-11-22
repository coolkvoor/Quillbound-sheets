/* Quillbound Sheets — fold and hide cards (the pencil at the top of each tab, "Arrange cards"). The app's own layout
 * choice, per character (IndexedDB view:<charKey> `cards`: { "<band>:<heading>": "fold" | "hide" }), never in the PDF.
 * In play a card heading does nothing to the layout, so a stray tap while scrolling can't fold or hide anything: only
 * Arrange mode changes it. A folded card shows its heading as one line; a tap on it opens the card for a look (`peek`,
 * not saved). A hidden card is gone from its tab; the tab says how many are hidden. Search and the tours still reach
 * them (search opens the card for a look; a tour shows every card while it runs). The Sheet tab is never arranged: it
 * has the way back (Reset layout is in the Arrange bar, which every tab opens). Shares helpers through window.MPMBUI. */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, $$, el, state } = U;

  const ARRANGED = (band) => band && band.id !== 'sheetinfo';
  // a card's key: its tab and its heading's own words. Cards on companion, Wild Shape and logsheet pages share keys by
  // their place on the page (their headings show a creature's or adventure's name, which changes).
  function keyOf(card) {
    const band = card.closest('section.band');
    const h = card.querySelector(':scope > h3');
    let name = '';
    const num = (s) => (String(s).match(/(\d+)\D*$/) || ['', ''])[1];
    if (card.dataset.ws) name = 'Shape ' + num(card.dataset.ws);
    else if (card.dataset.log) name = 'Entry ' + num(card.dataset.log);
    else if (h && h.querySelector('[data-compname]')) name = 'Companion';
    else if (h) {
      for (const c of h.childNodes) {
        if (c.nodeType === 1 && (c.tagName === 'BUTTON' || c.classList.contains('chip') || c.classList.contains('arr-ctl'))) continue;
        const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) { name = t; break; }
      }
    }
    return (band ? band.id : '') + ':' + name;
  }
  const choices = () => (state.view && state.view.cards) || {};

  // headings get the Arrange controls (shown only while arranging) and a fold mark; called for new cards too (the
  // companion, Wild Shape and logsheet pages are built when the sheet has them)
  function decorate(card) {
    if (card.dataset.ck) return false;
    const h = card.querySelector(':scope > h3');
    const band = card.closest('section.band');
    if (!h || !ARRANGED(band)) { card.dataset.ck = '-'; return false; }
    card.dataset.ck = keyOf(card);
    h.append(el('span', { cls: 'arr-chev', 'aria-hidden': 'true' }));   // shown first (CSS order); last in the DOM, so a heading's first text stays its name
    h.append(el('span', { cls: 'arr-ctl' }, [
      el('button', { cls: 'btn sm', type: 'button', 'data-arr': 'fold', 'aria-pressed': 'false' }),
      el('button', { cls: 'btn sm', type: 'button', 'data-arr': 'hide', 'aria-pressed': 'false' })
    ]));
    return true;
  }
  // a card's classes from the saved choices; returns true when that changed its look
  function style(card) {
    const k = card.dataset.ck;
    if (!k || k === '-') return false;
    const c = choices()[k] || '';
    const was = card.className;
    card.classList.toggle('folded', c === 'fold');
    card.classList.toggle('user-hidden', c === 'hide');
    for (const b of card.querySelectorAll(':scope > h3 > .arr-ctl > [data-arr]')) {
      const on = c === b.dataset.arr;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.dataset.label = b.dataset.arr === 'fold' ? (on ? 'Unfold' : 'Fold') : (on ? 'Show' : 'Hide');
      b.setAttribute('aria-label', b.dataset.label + ' this card');
    }
    const h = card.querySelector(':scope > h3');
    if (h) {
      const folded = c === 'fold' && !card.classList.contains('peek');
      if (c === 'fold' || c === 'hide') { h.setAttribute('role', 'button'); h.tabIndex = 0; h.setAttribute('aria-expanded', folded ? 'false' : 'true'); }
      else { h.removeAttribute('role'); h.removeAttribute('tabindex'); h.removeAttribute('aria-expanded'); }
    }
    return was !== card.className;
  }
  // how many cards are hidden in each tab: a line at its end that opens Arrange
  function notes() {
    for (const band of $$('#bands > section.band')) {
      if (!ARRANGED(band)) continue;
      let note = band.querySelector(':scope > .arr-note');
      if (!note) {
        note = el('p', { cls: 'arr-note', hidden: '' }, [el('span'), el('button', { cls: 'linkish', type: 'button', 'data-arrange': '1', text: 'Arrange' })]);
        band.append(note);
      }
      const n = $$('.card.user-hidden', band).filter((c) => !c.closest('[hidden]')).length;
      note.hidden = !n;
      note.firstChild.textContent = n === 1 ? '1 card hidden. ' : n + ' cards hidden. ';
    }
  }
  function relayout(cards) {
    const grids = Array.from(new Set(cards.map((c) => c.closest('.grid')).filter(Boolean)));
    if (grids.length) U.layoutGrids(true, grids);
  }
  // after a character opens: every card as this character has it, no card left open for a look
  function applyArrange() {
    const changed = [];
    for (const card of $$('#bands .card')) {
      decorate(card);
      card.classList.remove('peek');
      if (style(card)) changed.push(card);
    }
    notes();
    return changed;
  }
  // a look at a folded or hidden card (search, a tap on a folded heading); not saved
  function peekCard(card, on) {
    card.classList.toggle('peek', on === undefined ? true : on);
    style(card);
    relayout([card]);
  }
  async function choose(card, what) {
    if (!state.charKey) return;
    const k = card.dataset.ck;
    const cards = Object.assign({}, choices());
    if (cards[k] === what) delete cards[k]; else cards[k] = what;
    state.view.cards = cards;
    // every card with that key (the same card on each companion page) follows
    const same = $$('#bands .card').filter((c) => c.dataset.ck === k);
    for (const c of same) { c.classList.remove('peek'); style(c); }
    notes();
    relayout(same);
    await U.idbPut('view:' + state.charKey, state.view);
  }
  async function resetLayout() {
    if (!state.charKey) return;
    delete state.view.cards;
    relayout(applyArrange());
    await U.idbPut('view:' + state.charKey, state.view);
    U.toast('Every card is back, unfolded.');
  }
  function setArranging(on) {
    document.documentElement.classList.toggle('arranging', on);
    $('#arrange-bar').hidden = !on;
    for (const c of $$('#bands .card.peek')) { c.classList.remove('peek'); style(c); }
    U.layoutGrids(true);
    notes();
  }
  const arranging = () => document.documentElement.classList.contains('arranging');

  function wireArrange() {
    for (const band of $$('#bands > section.band')) {
      if (!ARRANGED(band)) continue;
      const t = band.querySelector(':scope > .band-title');
      if (!t) continue;
      band.classList.add('has-arr');
      t.after(el('button', { cls: 'btn sm icon-btn arr-open', type: 'button', 'data-arrange': '1', 'aria-label': 'Arrange cards: fold or hide them', title: 'Arrange cards' },
        [svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>')]));
    }
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('[data-arrange], [data-arr], .card.folded > h3, .card.user-hidden.peek > h3');
      if (!a) return;
      if (a.dataset.arrange) { e.preventDefault(); setArranging(true); return; }
      const card = a.closest('.card');
      if (a.dataset.arr) { e.preventDefault(); choose(card, a.dataset.arr); return; }
      // a folded heading: open or close it for a look (its own buttons, such as Options, still work)
      if (arranging() || e.target.closest('button, a, input, select, textarea, label')) return;
      peekCard(card, !card.classList.contains('peek'));
    });
    document.addEventListener('keydown', (e) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches || !e.target.matches('.card.folded > h3, .card.user-hidden.peek > h3') || arranging()) return;
      e.preventDefault();
      const card = e.target.closest('.card');
      peekCard(card, !card.classList.contains('peek'));
    });
    $('#arrange-done').addEventListener('click', () => setArranging(false));
    $('#arrange-reset').addEventListener('click', resetLayout);
    // cards built later (companion, Wild Shape and logsheet pages): give them their controls and this character's choices
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const fresh = $$('#bands .card:not([data-ck])').filter(decorate);
        const changed = fresh.filter(style);
        notes();
        if (changed.length) relayout(changed);
      });
    }).observe($('#bands'), { childList: true, subtree: true });
  }
  function svg(inner) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '18'], ['height', '18'], ['aria-hidden', 'true'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) s.setAttribute(k, v);
    s.innerHTML = inner;
    return s;
  }

  Object.assign(U, { wireArrange, applyArrange, peekCard, setArranging });
})();
