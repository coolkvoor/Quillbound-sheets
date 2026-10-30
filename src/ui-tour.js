/* Quillbound Sheets — the tour: a quick one (for people who know the sheet) and a full one, offered once after the first sheet opens and kept in Settings. Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, el } = U;

  // ---------------------------------------------------------------- the steps
  // A step: at (what to light up: a selector or a function), text. panel: the panel the step is in (opened by the user's
  // own tap at a "wait" step, by the tour when going back). missing: when it returns true the character doesn't have
  // the thing yet; the step still shows where it would be (missing.at), with missing.text. wait: the user taps the
  // lit-up button; the tour goes on when it returns true. Nothing the tour does changes the sheet.
  const shownEl = (n) => !!n && n.getClientRects().length > 0 && !n.closest('[hidden],[data-absent]');
  const first = (sel) => Array.from(document.querySelectorAll(sel)).filter(shownEl)[0] || null;
  const isOpen = (id) => { const d = document.getElementById(id); return !!d && d.open; };
  const noSpells = { when: () => !shownEl($('#tab-spells')), at: 'nav.tabs', text: 'This character has no spells. A Spells tab shows up here once it gets some.' };
  const noLimited = { when: () => !Array.from(document.querySelectorAll('#limited li[data-row]')).some(shownEl), text: 'No limited features yet. They show up here when you get them.' };
  const noInstall = { when: () => !shownEl($('#install-card')), at: null, text: 'Want it as an app? Use your browser’s menu: Add to Home screen.' };
  const skillDot = () => { const d = first('#skills [data-skill]'); return d ? d.parentNode : $('#skills'); };
  const sheetButton = () => first('[data-mpmb="SkillsClick"]') || first('main [data-mpmb]');
  const S = {
    book: { at: '#sources-open', text: 'Start here: pick the books the sheet may use. Tap the book.', wait: () => isOpen('sources-panel') },
    content: { panel: 'sources-panel', at: '#content', text: 'Have add-on content? Add the file here. Get files from the community index.' },
    books: { panel: 'sources-panel', at: '#sources', text: 'Then pick the books to use. Include all switches them all on.' },
    single: { panel: 'sources-panel', at: '#single-items', text: 'Leave out single items, or add ones the sheet leaves out, like firearms.' },
    closeBook: { panel: 'sources-panel', at: '#sources-close', text: 'Tap Close.', wait: () => !isOpen('sources-panel') },
    species: { at: '#f-race', text: 'Start with your species. Type a few letters and pick from the sheet’s list.' },
    cls: { at: '#class-open', text: 'Then your class, subclass and level. Level up and multiclass here too.' },
    bg: { at: '#f-bg', text: 'Pick your background.' },
    abilities: { at: '#abil-open', text: 'Set your ability scores: point buy, rolled or typed in.' },
    sheetBtn: { at: sheetButton, text: 'Buttons like this open the sheet’s own menus and dialogs, as in Acrobat.' },
    skills: { at: skillDot, text: 'Tap a skill’s dot for proficiency. Tap again for expertise.' },
    spells: { at: () => first('#casters button.primary') || $('#spells'), text: 'Choose your spells here.', missing: noSpells },
    gear: { at: '[data-mpmb="Equipment.menu"]', text: 'Add your gear and packs from the sheet’s list.' },
    pages: { at: '#pages', text: 'A companion, Wild Shape or notes? Add their pages here.' },
    roll: { at: '[data-roll="d20"][data-kind="init"]', text: 'Tap any number to roll it: attacks, saves, skills.' },
    dice: { at: '#dice-open', text: 'Other dice? Roll them here.' },
    hp: { at: () => { const n = $('#f-hp'); return n && n.closest('.card'); }, text: 'Keep track of your hit points here.' },
    rests: { at: '.rests', text: 'Rested? Tap here. Short rest gives back the features that recharge on one. Long rest also gives back your spell slots.' },
    limited: { at: () => $('#limited') && $('#limited').closest('.card'), text: 'Mark a feature’s use here when you use it.', missing: noLimited },
    saved: { at: '#save-chip', text: 'Your character is saved in this browser as you go. Clearing the browser’s data deletes it.' },
    pdf: { at: '#save-pdf', text: 'So download it now and then. The PDF holds your character and opens in Adobe Acrobat too.' },
    gearOpen: { at: '#settings-open', text: 'Tap the gear.', wait: () => isOpen('settings') },
    install: { panel: 'settings', at: '#install-card', text: 'Install the app. It then works offline.', missing: noInstall },
    backups: { panel: 'settings', at: '#backup-card', text: 'Backups: the app can keep a copy of your PDF in a folder for you.' },
    look: { panel: 'settings', at: '#look', text: 'Pick a look. “Match my sheet” follows your PDF.' },
    again: { panel: 'settings', at: '#tour-card', text: 'Watch this tour again here. Have fun!' },
  };
  // the full tour (new to the sheet): what you do, in order, a chapter at a time; within a chapter the page only
  // scrolls down. The quick tour (knows the sheet): only what differs from the sheet in Acrobat.
  const FULL = [
    ['Set up', ['book', 'content', 'books', 'closeBook']],
    ['Build', ['species', 'cls', 'bg', 'abilities', 'sheetBtn', 'skills', 'spells', 'gear', 'pages']],
    ['Play', ['roll', 'dice', 'hp', 'rests', 'limited']],
    ['Keep it safe', ['saved', 'pdf', 'gearOpen', 'backups', 'install']],
    ['Make it yours', ['look', 'again']],
  ];
  const QUICK = [
    ['Quick tour', ['book', 'content', 'books', 'single', 'closeBook', 'sheetBtn', 'roll', 'saved', 'pdf', 'gearOpen', 'look', 'backups', 'install', 'again']],
  ];
  const QUICK_TEXT = {
    book: 'Your sources are behind the book: content files and books. Set them first. Tap it.',
    roll: 'Tap any number to roll it. The die at the top rolls anything else.',
    saved: 'Your character is saved in this browser, not in your PDF.',
    pdf: 'Download PDF writes it into the sheet, for Acrobat or another device.',
    look: 'The sheet’s looks are here, not on the sheet. “Match my sheet” follows your PDF.',
  };
  function buildSteps(long) {
    const out = [];
    for (const [chapter, ids] of long ? FULL : QUICK) ids.forEach((id, k) => out.push(Object.assign({}, S[id], { chapter, k: k + 1, of: ids.length, last: k === ids.length - 1 }, !long && QUICK_TEXT[id] ? { text: QUICK_TEXT[id] } : {})));
    // a chapter's "Next" says where it goes
    out.forEach((s, i) => { if (s.last && out[i + 1]) s.nextLabel = 'Next: ' + out[i + 1].chapter; });
    return out;
  }

  // ---------------------------------------------------------------- the layer
  let tour = null;   // { steps, i, node, raf }
  const PAD = 6;
  function layer() {
    const dim = el('div', { cls: 'tour-dim' });
    const block = el('div', { cls: 'tour-block' });
    const ring = el('div', { cls: 'tour-ring' });
    const text = el('p', { cls: 'tour-text', id: 'tour-text' });
    const count = el('span', { cls: 'tour-n' });
    const skip = el('button', { cls: 'btn sm', type: 'button', text: 'Stop' });
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
        const steps = buildSteps(long);
        if (sample) steps.unshift({ at: '#hdr-name', text: 'This is a sample character for the tour. Yours is safe and comes back when the tour ends.', chapter: '' });
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
    ui.count.textContent = step.chapter ? step.chapter + (step.of > 1 ? ' · ' + step.k + ' of ' + step.of : '') : '';
    ui.back.disabled = i === 0;
    ui.next.hidden = !!step.wait;
    ui.next.textContent = i === tour.steps.length - 1 ? 'Done' : step.nextLabel || 'Next';
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
