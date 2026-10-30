/* Quillbound Sheets — the tour: a quick one (for people who know the sheet) and a full one, offered once after the first sheet opens and kept in Settings. Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, el } = U;

  // ---------------------------------------------------------------- the steps
  // at: what to light up (a selector or a function). long: only in the full tour. panel: the panel the step is in
  // (opened by the user's own tap at a "wait" step, by the tour when going back). missing: when it returns true the
  // character doesn't have the thing yet; the step still shows where it would be (missing.at), with missing.text.
  // wait: the user taps the lit-up button; the tour goes on when done() is true. Nothing the tour does changes the sheet.
  const shownEl = (n) => !!n && n.getClientRects().length > 0 && !n.closest('[hidden],[data-absent]');
  const first = (sel) => Array.from(document.querySelectorAll(sel)).filter(shownEl)[0] || null;
  const isOpen = (id) => { const d = document.getElementById(id); return !!d && d.open; };
  // in the order of the screen, top to bottom: the top bar and tab bar, then each section, then the two panels
  const STEPS = [
    { at: '#save-chip', text: 'Your character saves on this device as you go.' },
    { at: 'nav.tabs', text: 'Jump to each part of your sheet. Some tabs only show up when you need them, like Spells or Companion.' },
    // Main
    { long: true, at: '#f-race', text: 'Start typing to pick from the sheet’s lists. Same for background, feats and items.' },
    { at: '#class-open', text: 'Pick your class, subclass and level. Level up and multiclass here too.' },
    { long: true, at: '#abil-open', text: 'Set your ability scores: point buy, rolled or typed in.' },
    { at: () => first('[data-mpmb="SkillsClick"]') || first('main [data-mpmb]'), text: 'Buttons like this run the sheet’s own menus and dialogs, as in Acrobat.' },
    { long: true, at: () => { const d = first('#skills [data-skill]'); return d ? d.parentNode : $('#skills'); }, text: 'Tap a skill’s dot: proficient, then expertise, then off.' },
    // Combat
    { at: '[data-roll="d20"][data-kind="init"]', text: 'Tap a number to roll it. Attacks, saves and skills too.' },
    { at: '#dice-open', text: 'Or roll any dice here.' },
    { long: true, at: '[data-mpmb="Buttons.HP Max"]', text: 'Tap Set and the sheet works out your max HP.' },
    // Spells
    { long: true, at: '#spells', text: 'Your spells: pick them, see your list and mark slots used.',
      missing: { when: () => !shownEl($('#tab-spells')), at: 'nav.tabs', text: 'No spells yet. A Spells tab shows up here once you can cast them.' } },
    // Features
    { at: '.rests', text: 'Rested? Tap here. Short rest gives back the features that recharge on one. Long rest also gives back your spell slots.' },
    { long: true, at: () => $('#limited') && $('#limited').closest('.card'), text: 'Track the uses of your features here.',
      missing: { when: () => !Array.from(document.querySelectorAll('#limited li[data-row]')).some(shownEl), text: 'No limited features yet. They show up here when you get them.' } },
    // Gear
    { long: true, at: () => $('#attuned-chip') && $('#attuned-chip').closest('.card'), text: 'Magic items. The dot marks attunement.' },
    { long: true, at: '[data-mpmb="Equipment.menu"]', text: 'Add gear and packs from the sheet’s list.' },
    // Sheet
    { at: '#save-pdf', text: 'Download your character as a PDF. It opens in Adobe Acrobat too.' },
    { long: true, at: '#new-char', text: 'Start over, or bring in a character from another sheet.' },
    { long: true, at: '#pages', text: 'Add pages: a companion, Wild Shape, notes or an Adventurers League log.' },
    { long: true, at: '#mpmb-settings', text: 'The sheet’s settings: weight, units, fonts and automation.' },
    // Sources (the book in the top bar)
    { at: '#sources-open', text: 'Tap the book to see your sources.', wait: () => isOpen('sources-panel') },
    { panel: 'sources-panel', at: '#content', text: 'Add content files here for more books. Get them from the community index.' },
    { panel: 'sources-panel', at: '#sources', text: 'Pick which books the sheet uses.' },
    { panel: 'sources-panel', at: '#single-items', text: 'Leave out or add single items, like firearms.' },
    { panel: 'sources-panel', at: '#sources-close', text: 'Tap Close.', wait: () => !isOpen('sources-panel') },
    // Settings (the gear)
    { at: '#settings-open', text: 'Tap the gear for settings.', wait: () => isOpen('settings') },
    { panel: 'settings', at: '#look', text: 'Pick a look. “Match my sheet” follows your PDF.' },
    { panel: 'settings', at: '#backup-card', text: 'Backups: pick a folder and the app keeps a copy of your PDF there.' },
    { panel: 'settings', at: '#install-card', text: 'Install the app. It then works offline.',
      missing: { when: () => !shownEl($('#install-card')), at: null, text: 'Want it as an app? Use your browser’s menu: Add to Home screen.' } },
    { panel: 'settings', at: '#tour-card', text: 'Watch this tour again here. That’s it, have fun!' },
  ];

  // ---------------------------------------------------------------- the layer
  let tour = null;   // { steps, i, node, raf }
  const PAD = 6;
  function layer() {
    const dim = el('div', { cls: 'tour-dim' });
    const block = el('div', { cls: 'tour-block' });
    const ring = el('div', { cls: 'tour-ring' });
    const text = el('p', { cls: 'tour-text', id: 'tour-text' });
    const count = el('span', { cls: 'tour-n' });
    const skip = el('button', { cls: 'btn sm', type: 'button', text: 'Skip' });
    const back = el('button', { cls: 'btn sm', type: 'button', text: 'Back' });
    const next = el('button', { cls: 'btn sm primary', type: 'button', text: 'Next' });
    const card = el('div', { cls: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-text' }, [text, el('div', { cls: 'tour-foot' }, [count, skip, back, next])]);
    const node = el('div', { cls: 'tour', id: 'tour' }, [dim, block, ring, card]);
    skip.addEventListener('click', () => end());
    back.addEventListener('click', () => go(tour.i - 1, -1));
    next.addEventListener('click', () => go(tour.i + 1, 1));
    node.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); end(); } });
    return { node, dim, block, ring, card, text, count, back, next };
  }

  // the tour runs on a sample character (app.js withSample: a second copy of the sheet; the user's own character is
  // saved first, nothing is stored meanwhile, and it comes back when the tour ends)
  let starting = false;
  async function start(long) {
    if (tour || starting) return;
    starting = true;
    for (const id of ['settings', 'sources-panel']) if (isOpen(id)) document.getElementById(id).close();
    try {
      await U.withSample((sample) => new Promise((resolve) => {
        const steps = STEPS.filter((s) => long || !s.long);
        if (sample) steps.unshift({ at: '#hdr-name', text: 'This is a sample character for the tour. Yours is safe and comes back when the tour ends.' });
        tour = { steps, i: 0, ui: layer(), target: null, key: '', done: resolve };
        starting = false;
        show(0, 1);
        const loop = () => { if (!tour) return; place(); tour.raf = requestAnimationFrame(loop); };
        tour.raf = requestAnimationFrame(loop);
      }));
    } finally { starting = false; }
  }
  function end() {
    if (!tour) return;
    cancelAnimationFrame(tour.raf);
    tour.ui.node.remove();
    const done = tour.done;
    tour = null;
    if (done) done();
  }
  // the panel a step needs open (or none): going back may need one opened or closed again
  function ensurePanel(step) {
    for (const id of ['settings', 'sources-panel']) {
      const want = step.panel === id;
      if (want && !isOpen(id)) $(id === 'settings' ? '#settings-open' : '#sources-open').click();
      else if (!want && isOpen(id)) document.getElementById(id).close();
    }
  }
  function target(step, miss) {
    const at = miss && 'at' in step.missing ? step.missing.at : step.at;
    if (!at) return null;
    let n = typeof at === 'function' ? at() : first(at);
    if (!shownEl(n)) return null;
    // something taller than about half the screen (a whole section or a long card): light up its heading
    if (n.getBoundingClientRect().height > window.innerHeight * 0.45) { const h = n.querySelector('h2, h3'); if (shownEl(h)) { h.dataset.tourTall = '1'; n = h; } }
    return n;
  }
  function go(i, dir) {
    if (!tour) return;
    if (i >= tour.steps.length) { end(); return; }
    if (i < 0) return;
    show(i, dir);
  }
  function show(i, dir) {
    const step = tour.steps[i];
    ensurePanel(step);
    const miss = !!(step.missing && step.missing.when());
    const t = target(step, miss);
    // a thing this sheet doesn't have at all (and no "missing" text for it): pass over it
    if (!t && !(miss && step.missing.at === null)) { if (i + dir >= 0 && i + dir < tour.steps.length) { tour.i = i; go(i + dir, dir); } else if (dir > 0) end(); return; }
    tour.i = i; tour.target = t; tour.step = step; tour.key = '';
    const ui = tour.ui;
    // inside an open panel the layer has to be in that dialog (the rest of the page is inert while it is open)
    const host = step.panel && isOpen(step.panel) ? document.getElementById(step.panel) : document.body;
    if (ui.node.parentNode !== host) host.append(ui.node);
    ui.text.textContent = miss ? step.missing.text : step.text;
    ui.node.classList.toggle('waiting', !!step.wait && !miss);
    ui.node.classList.toggle('missing', miss);
    ui.count.textContent = (i + 1) + ' of ' + tour.steps.length;
    ui.back.disabled = i === 0;
    ui.next.hidden = !!step.wait;
    ui.next.textContent = i === tour.steps.length - 1 ? 'Done' : 'Next';
    // a heading standing for a tall card goes near the top, so the card shows under it
    tour.tall = !!(t && t.dataset.tourTall);
    if (t) { delete t.dataset.tourTall; reveal(t, tour.tall); }
    (step.wait ? ui.back : ui.next).focus({ preventScroll: true });
  }

  // scroll the thing into view: in a panel its own list scrolls; on the page the window does, never past its end (asking
  // for more made the phone shift the whole view and show a blank band)
  function reveal(t, top) {
    const behavior = U.reduceMotion() ? 'auto' : 'smooth';
    if (t.closest('dialog')) { t.scrollIntoView({ block: top ? 'start' : 'center', behavior }); return; }
    if (t.closest('header.top, nav.tabs')) return;   // always on screen
    const r = t.getBoundingClientRect(), head = ($('header.top') || { offsetHeight: 0 }).offsetHeight;
    const want = top ? r.top - head - 16 : r.top + r.height / 2 - window.innerHeight / 2;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.max(0, Math.min(max, window.scrollY + want)), behavior });
  }
  // follow the lit-up thing (it scrolls into view, the page reflows) and go on once a wait step is done
  function place() {
    const ui = tour.ui, step = tour.step;
    if (step.wait && step.wait()) { go(tour.i + 1, 1); return; }
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = tour.target && tour.target.isConnected ? tour.target.getBoundingClientRect() : null;
    const box = r ? { x: Math.max(4, r.left - PAD), y: Math.max(4, r.top - PAD), x2: Math.min(vw - 4, r.right + PAD), y2: Math.min(vh - 4, r.bottom + PAD) } : null;
    const key = box ? [box.x, box.y, box.x2, box.y2].map(Math.round).join() : 'none';
    if (key === tour.key) return;
    tour.key = key;
    if (box) {
      const hole = box.x + 'px ' + box.y + 'px, ' + box.x2 + 'px ' + box.y + 'px, ' + box.x2 + 'px ' + box.y2 + 'px, ' + box.x + 'px ' + box.y2 + 'px, ' + box.x + 'px ' + box.y + 'px';
      ui.dim.style.clipPath = 'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ' + hole + ')';
      Object.assign(ui.ring.style, { display: '', left: box.x + 'px', top: box.y + 'px', width: (box.x2 - box.x) + 'px', height: (box.y2 - box.y) + 'px' });
      Object.assign(ui.block.style, { left: box.x + 'px', top: box.y + 'px', width: (box.x2 - box.x) + 'px', height: (box.y2 - box.y) + 'px' });
    } else {
      ui.dim.style.clipPath = 'none';
      ui.ring.style.display = 'none';
    }
    // the card below the thing when it fits, else above, else at the bottom
    const c = ui.card, ch = c.offsetHeight, gap = 12;
    let top;
    if (!box) top = (vh - ch) / 2;
    else if (tour.tall) top = vh - ch - 8;   // under a lit-up heading is what it stands for: keep that free
    else if (box.y2 + gap + ch <= vh - 8) top = box.y2 + gap;
    else if (box.y - gap - ch >= 8) top = box.y - gap - ch;
    else top = vh - ch - 8;
    c.style.top = Math.max(8, top) + 'px';
  }

  // ---------------------------------------------------------------- offered once, and in Settings
  const KEY = 'mpmb-tour';
  const seen = () => { try { return !!localStorage.getItem(KEY); } catch (e) { return true; } };
  const markSeen = () => { try { localStorage.setItem(KEY, 'seen'); } catch (e) { /* asked again next time */ } };
  // after the first sheet opens: wait until nothing else is on screen
  function offerTour() {
    if (seen()) return;
    let tries = 0;
    const tryNow = () => {
      if (seen() || $('#sheet').hidden) return;
      if (document.querySelector('dialog[open]') && tries++ < 60) { setTimeout(tryNow, 1000); return; }
      markSeen();
      $('#tour-ask').showModal();
    };
    setTimeout(tryNow, 800);
  }
  function wireTour() {
    const ask = $('#tour-ask');
    ask.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      ask.close();
      if (b.dataset.tour !== 'no') start(b.dataset.tour === 'long');
    });
    for (const b of document.querySelectorAll('#tour-card [data-tour]')) b.addEventListener('click', () => start(b.dataset.tour === 'long'));
  }

  Object.assign(U, {
    offerTour, wireTour, startTour: start
  });
})();
