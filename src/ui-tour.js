/* Quillbound Sheets — the guides, all on the user's own sheet: a quick tour (where things are, for people who know the
 * sheet), a full tour of a made character (everything and where it lives), and a character guide that walks through
 * making one from the ground up (what the user does is kept). Offered after the first sheet opens, by what the sheet
 * holds, and kept in Settings. Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, el, state } = U;

  // ---------------------------------------------------------------- the steps
  // A step: at (what to light up: a selector or a function), text. panel: the panel the step is in (opened by the user's
  // own tap at a "wait" step, by the tour when going back). missing: when it returns true the character doesn't have
  // the thing yet; the step still shows where it would be (missing.at), with missing.text. wait: the user taps the
  // lit-up button; the tour goes on when it returns true. The two tours change nothing on the sheet.
  // The character guide's steps (BUILD) have done: the guide goes on by itself once it returns true (Skip leaves it
  // for later), and a step already done is passed over, so starting the guide again goes on where it was left.
  const shownEl = (n) => !!n && n.getClientRects().length > 0 && !n.closest('[hidden],[data-absent]');
  const first = (sel) => Array.from(document.querySelectorAll(sel)).filter(shownEl)[0] || null;
  const isOpen = (id) => { const d = document.getElementById(id); return !!d && d.open; };
  const v = (name) => U.shown(state.snap.get(name)).trim();
  const noSpells = { when: () => !shownEl($('#tab-spells')), at: 'nav.tabs', text: 'This character has no spells. A Spells tab shows up here once it gets some.' };
  const noLimited = { when: () => !Array.from(document.querySelectorAll('#limited li[data-row]')).some(shownEl), text: 'No limited features yet. They show up here when you get them.' };
  const noFeatures = { when: () => !first('[data-rich="Class Features"] details.feat'), text: 'No class yet. Its features show up here once you pick one.' };
  const noInstall = { when: () => !shownEl($('#install-card')), at: null, text: 'Want it as an app? Use your browser’s menu: Add to Home screen.' };
  const noCompanion = { when: () => !shownEl($('#companion')), at: '#pages', text: 'No companion yet. A familiar, mount or pet gets its own page: add one here, under Pages.' };
  const skillDot = () => { const d = first('#skills [data-skill]'); return d ? d.parentNode : $('#skills'); };
  const sheetButton = () => first('[data-mpmb="SkillsClick"]') || first('main [data-mpmb]');
  const card = (sel) => () => { const n = first(sel); return n && n.closest('.card'); };
  const S = {
    book: { at: '#sources-open', text: 'Start here: pick the books the sheet may use. Tap the book.', wait: () => isOpen('sources-panel') },
    content: { panel: 'sources-panel', at: '#content', text: 'Have add-on content? Add the file here. Get files from the community index.' },
    books: { panel: 'sources-panel', at: '#sources', text: 'Then pick the books to use. Include all switches them all on.' },
    single: { panel: 'sources-panel', at: '#single-items', text: 'Leave out single items, or add ones the sheet leaves out, like firearms.' },
    closeBook: { panel: 'sources-panel', at: '#sources-close', text: 'Tap Close.', wait: () => !isOpen('sources-panel') },
    name: { at: '#f-name', text: 'Your character’s name.' },
    species: { at: '#f-race', text: 'Your species. Type to change it and the sheet updates everything.' },
    cls: { at: '#class-open', text: 'Your class, subclass and level. Level up and multiclass here.' },
    abilities: { at: '#abil-open', text: 'Your ability scores: point buy, rolled or typed in. Improvements go here too.' },
    sheetBtn: { at: sheetButton, text: 'Buttons like this open the sheet’s own menus and dialogs, as in Acrobat.' },
    skills: { at: skillDot, text: 'Tap a skill’s dot for proficiency. Tap again for expertise.' },
    roll: { at: '[data-roll="d20"][data-kind="init"]', text: 'Tap any number to roll it: attacks, saves, skills.' },
    dice: { at: '#dice-open', text: 'Other dice? Roll them here.' },
    search: { at: '#search-open', text: 'Looking for something? Search the whole sheet: features, spells, gear, notes.' },
    hp: { at: () => { const n = $('#f-hp'); return n && n.closest('.card'); }, text: 'Keep track of your hit points here.' },
    actions: { at: () => $('#actions') && $('#actions').closest('.card'), text: 'Tap an action to read what it does, right here.' },
    spells: { at: () => first('#casters button.primary') || $('#spells'), text: 'Your spells: choose them here, then tap one for its details.', missing: noSpells },
    rests: { at: '.rests', text: 'Rested? Tap here. Short rest gives back the features that recharge on one. Long rest also gives back your spell slots.' },
    limited: { at: () => $('#limited') && $('#limited').closest('.card'), text: 'Mark a feature’s use here when you use it.', missing: noLimited },
    features: { at: () => { const n = $('[data-rich="Class Features"]'); return n && n.closest('.card'); }, text: 'Your class features. Tap one to read it; its options fold inside it.', missing: noFeatures },
    feats: { at: card('#feats'), text: 'Your feats, with what each one does.' },
    bg: { at: '#f-bg', text: 'Your background. Its feature, personality and story are on the Features tab.' },
    notes: { at: '#notes-card', text: 'Notes: what the sheet keeps on its third page, and your own notes.' },
    magic: { at: card('#magic-items'), text: 'Magic items: pick one from the list, mark it attuned, read what it does.' },
    gear: { at: '[data-mpmb="Equipment.menu"]', text: 'Add your gear and packs from the sheet’s list.' },
    companion: { at: '#companion', text: 'Your companion has its own page: its stats, attacks and notes.', missing: noCompanion },
    pages: { at: '#pages', text: 'A companion, Wild Shape or notes? Add their pages here.' },
    saved: { at: '#save-chip', text: 'Your character is saved in this browser as you go. Clearing the browser’s data deletes it.' },
    pdf: { at: '#save-pdf', text: 'So download it now and then. The PDF holds your character and opens in Adobe Acrobat too.' },
    pdfFirst: { at: '#save-pdf', text: 'Download PDF writes your character into the sheet: a copy to keep, that opens in Adobe Acrobat too.' },
    savedAfter: { at: '#save-chip', text: 'Meanwhile it’s saved in this browser as you go. Clearing the browser’s data deletes it, so download now and then.' },
    gearOpen: { at: '#settings-open', text: 'Tap the gear.', wait: () => isOpen('settings') },
    install: { panel: 'settings', at: '#install-card', text: 'Install the app. It then works offline.', missing: noInstall },
    backups: { panel: 'settings', at: '#backup-card', text: 'Backups: the app can keep a copy of your PDF in a folder for you.' },
    look: { panel: 'settings', at: '#look', text: 'Pick a look. “Match my sheet” follows your PDF.' },
    again: { panel: 'settings', at: '#tour-card', text: 'The tours and the character guide are here whenever you want them. Have fun!' },
  };
  // the full tour (a made character): everything and where it is, a chapter at a time, in the page's order (within a
  // chapter the page only scrolls down). The quick tour (knows the sheet): only what differs from the sheet in Acrobat.
  const FULL = [
    ['Sources', ['book', 'content', 'books', 'closeBook']],
    ['Your character', ['name', 'species', 'cls', 'bg', 'abilities', 'sheetBtn', 'skills']],
    ['Play', ['roll', 'dice', 'search', 'hp', 'actions', 'spells', 'rests', 'limited', 'features', 'feats', 'notes']],
    ['Gear and pages', ['magic', 'gear', 'companion', 'pages']],
    ['Keep it safe', ['pdfFirst', 'savedAfter', 'gearOpen', 'backups', 'install']],
    ['Make it yours', ['look', 'again']],
  ];
  const QUICK = [
    ['Quick tour', ['book', 'content', 'books', 'single', 'closeBook', 'sheetBtn', 'roll', 'search', 'actions', 'features', 'saved', 'pdf', 'gearOpen', 'look', 'backups', 'install', 'again']],
  ];
  const QUICK_TEXT = {
    book: 'Your sources are behind the book: content files and books. Set them first. Tap it.',
    roll: 'Tap any number to roll it. The die at the top rolls anything else.',
    features: 'What the sheet puts on its third page, like a Monk’s Focus options, shows here inside its feature.',
    saved: 'Your character is saved in this browser, not in your PDF.',
    pdf: 'Download PDF writes it into the sheet, for Acrobat or another device.',
    look: 'The sheet’s looks are here, not on the sheet. “Match my sheet” follows your PDF.',
  };

  // the character guide: the sheet's order (sources first, as the sheet asks), each step done on the user's own sheet
  let sourcesSeen = false;
  const gearFilled = () => { for (const [k, s] of state.snap) if (/^Adventuring Gear Row \d+$/.test(k) && U.shown(s).trim()) return true; return false; };
  const B = {
    bSources: { at: '#sources-open', text: 'First, the books your character may use: tap the book, tick your books, then Close.', done: () => sourcesSeen && !isOpen('sources-panel') },
    bSpecies: { at: '#f-race', text: 'Pick your species: type a few letters and choose it from the list.', done: () => v('Race') !== '' },
    bSpeciesOpts: { at: () => first('[data-mpmb="Race Features Menu"]'), text: 'Your species has choices of its own, like an Elf’s lineage. Tap Options to pick them.' },
    bClass: { at: '#class-open', text: 'Now your class and level. Add the subclass once you reach its level.', done: () => v('Class and Levels') !== '' },
    bChoices: { at: () => (/Choose Feature/i.test(v('Class Features')) ? first('[data-mpmb="Class Features Menu"]') : null), text: 'Some class features need a choice from you. Tap Choose feature and pick one, until none are left.', done: () => !/Choose Feature/i.test(v('Class Features')) },
    bBackground: { at: '#f-bg', text: 'Pick your background. It sets skills, a feat and ability score increases.', done: () => v('Background') !== '' },
    bAbilities: { at: '#abil-open', text: 'Set your ability scores. Put your background’s increases in its column.', done: () => ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'].every((a) => v(a) !== '') },
    bSkills: { at: skillDot, text: 'Tap the dot of each skill your class lets you pick. Your background’s skills are already marked.' },
    bHp: { at: () => first('[data-mpmb="Buttons.HP Max"]'), text: 'Set your maximum hit points: tap Set and choose how.', done: () => v('HP Max') !== '' },
    bSpells: { at: () => first('#casters button.primary'), text: 'You can cast spells: tap Choose spells and pick them.', done: () => !$('#spell-actions').hidden },
    bGear: { at: '[data-mpmb="Equipment.menu"]', text: 'Add your starting gear: the menu has your class’s and background’s packs.', done: gearFilled },
    bName: { at: '#f-name', text: 'Last, give your character a name.', done: () => v('PC Name') !== '' },
    bDone: { at: '#save-pdf', text: 'All set! It’s saved in this browser as you go. Download the PDF now and then to keep a copy.' },
  };
  const BUILD = [['Your character', ['bSources', 'bSpecies', 'bSpeciesOpts', 'bClass', 'bChoices', 'bBackground', 'bAbilities', 'bSkills', 'bHp', 'bSpells', 'bGear', 'bName', 'bDone']]];

  function buildSteps(kind) {
    const out = [];
    const plan = kind === 'build' ? BUILD : kind === 'full' ? FULL : QUICK, lib = kind === 'build' ? B : S;
    for (const [chapter, ids] of plan) ids.forEach((id, k) => out.push(Object.assign({}, lib[id], { chapter, k: k + 1, of: ids.length, last: k === ids.length - 1 }, kind === 'quick' && QUICK_TEXT[id] ? { text: QUICK_TEXT[id] } : {})));
    // a chapter's "Next" says where it goes
    out.forEach((s, i) => { if (s.last && out[i + 1]) s.nextLabel = 'Next: ' + out[i + 1].chapter; });
    return out;
  }

  // ---------------------------------------------------------------- the layer
  let tour = null;   // { kind, steps, i, ui, target, step, key, raf }
  const PAD = 6;
  function layer() {
    const dim = el('div', { cls: 'tour-dim' });
    const block = el('div', { cls: 'tour-block' });
    const ring = el('div', { cls: 'tour-ring' });
    const text = el('p', { cls: 'tour-text', id: 'tour-text' });
    const count = el('span', { cls: 'tour-n' });
    const stop = el('button', { cls: 'btn sm', type: 'button', text: 'Stop' });
    const back = el('button', { cls: 'btn sm', type: 'button', text: 'Back' });
    const skip = el('button', { cls: 'btn sm', type: 'button', text: 'Skip' });
    const next = el('button', { cls: 'btn sm primary', type: 'button', text: 'Next' });
    const box = el('div', { cls: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-text', tabindex: '-1' }, [text, el('div', { cls: 'tour-foot' }, [count, stop, back, skip, next])]);
    const node = el('div', { cls: 'tour', id: 'tour' }, [dim, block, ring, box]);
    stop.addEventListener('click', () => end());
    back.addEventListener('click', () => go(tour.i - 1, -1));
    skip.addEventListener('click', () => go(tour.i + 1, 1, true));
    next.addEventListener('click', () => go(tour.i + 1, 1, true));
    node.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); end(); } });
    return { node, dim, block, ring, card: box, text, count, back, skip, next };
  }

  // kind: 'quick', 'full' (the tours, nothing on the sheet changes) or 'build' (the character guide: the page stays
  // usable, the user does each step on their own sheet)
  function start(kind) {
    if (tour) end();
    for (const id of ['settings', 'sources-panel']) if (isOpen(id)) document.getElementById(id).close();
    sourcesSeen = false;
    const steps = buildSteps(kind);
    tour = { kind, steps, i: 0, ui: layer(), target: null, key: '' };
    tour.ui.node.classList.toggle('free', kind === 'build');
    if (kind === 'build') tour.ui.card.setAttribute('aria-modal', 'false');   // the page stays usable
    show(0, 1);
    const loop = () => { if (!tour) return; place(); tour.raf = requestAnimationFrame(loop); };
    tour.raf = requestAnimationFrame(loop);
  }
  function end() {
    if (!tour) return;
    cancelAnimationFrame(tour.raf);
    tour.ui.node.remove();
    tour = null;
  }
  // the panel a step needs open (or none): going back may need one opened or closed again (not in the guide: there the
  // user opens and closes things)
  function ensurePanel(step) {
    if (tour.kind === 'build') return;
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
  // user: Next or Skip was tapped (in the guide a step already done is still passed over then)
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
    // a thing this sheet or character doesn't have (and no "missing" text for it), or a guide step already done: pass
    // over it (going forward; going back, to the step before it)
    const pass = (!t && !(miss && step.missing.at === null)) || (step.done && step.done() && dir > 0);
    if (pass) { if (i + dir >= 0 && i + dir < tour.steps.length) { tour.i = i; go(i + dir, dir); } else if (dir > 0) end(); return; }
    tour.i = i; tour.target = t; tour.step = step; tour.key = ''; tour.doneAt = 0;
    const ui = tour.ui;
    // inside an open panel the layer has to be in that dialog (the rest of the page is inert while it is open)
    const host = step.panel && isOpen(step.panel) ? document.getElementById(step.panel) : document.body;
    if (ui.node.parentNode !== host) host.append(ui.node);
    ui.text.textContent = miss ? step.missing.text : step.text;
    ui.node.classList.toggle('waiting', !!step.wait && !miss);
    ui.node.classList.toggle('missing', miss);
    ui.node.classList.remove('done');
    ui.count.textContent = step.chapter ? step.chapter + (step.of > 1 ? ' · ' + step.k + ' of ' + step.of : '') : '';
    ui.back.disabled = i === 0;
    ui.skip.hidden = !step.done;
    ui.next.hidden = !!step.wait || !!step.done;
    ui.next.textContent = i === tour.steps.length - 1 ? 'Done' : step.nextLabel || 'Next';
    // a heading standing for a tall card goes near the top, so the card shows under it
    tour.tall = !!(t && t.dataset.tourTall);
    if (t) { delete t.dataset.tourTall; reveal(t, tour.tall); }
    (step.wait || step.done ? ui.card : ui.next).focus({ preventScroll: true });
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
    if (tour.kind === 'build') {
      // the guide: out of the way while a panel or the sheet's dialog is open (the user works there); a step done
      // shows a tick for a moment, then the guide goes on
      if (isOpen('sources-panel')) sourcesSeen = true;
      const busy = !!document.querySelector('dialog[open]');
      ui.node.hidden = busy;
      if (busy) { tour.key = ''; return; }
      if (step.done && step.done()) {
        if (!tour.doneAt) { tour.doneAt = Date.now(); ui.node.classList.add('done'); ui.text.textContent = '✓ Done. ' + step.text; }
        else if (Date.now() - tour.doneAt > 900) { go(tour.i + 1, 1); return; }
      }
      // the target can come and go (a Choose feature button, the spells' button after a class)
      if (!tour.target || !tour.target.isConnected || !shownEl(tour.target)) { const t = target(step, false); if (t) tour.target = t; }
    }
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
    const c = ui.card, ch = c.offsetHeight, gap = 12, head = ($('header.top') || { offsetHeight: 0 }).offsetHeight;
    let top;
    if (tour.kind === 'build') {
      // the guide's card keeps clear of what the user types into (and its list of suggestions below it)
      top = !box || box.y2 < vh * 0.55 ? vh - ch - 8 : head + 8;
    } else if (!box) top = (vh - ch) / 2;   // the card below the thing when it fits, else above, else at the bottom
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
  // a sheet without a species or class yet: the character guide is the one to offer
  const emptySheet = () => v('Race') === '' && v('Class and Levels') === '';
  // after the first sheet opens: wait until nothing else is on screen, then offer what fits the sheet
  function offerTour() {
    if (seen()) return;
    let tries = 0;
    const tryNow = () => {
      if (seen() || $('#sheet').hidden) return;
      if (document.querySelector('dialog[open]') && tries++ < 60) { setTimeout(tryNow, 1000); return; }
      markSeen();
      const empty = emptySheet(), ask = $('#tour-ask');
      $('#tour-ask-title').textContent = empty ? 'New character?' : 'New here?';
      $('#tour-ask-text').textContent = empty ? 'The character guide walks you through making one, step by step, on your own sheet. What you fill in is kept.' : 'Want a tour of where everything is on your character? It changes nothing.';
      ask.querySelector('[data-tour="build"]').hidden = !empty;
      ask.querySelector('[data-tour="full"]').hidden = empty;
      ask.showModal();
    };
    setTimeout(tryNow, 800);
  }
  function wireTour() {
    const ask = $('#tour-ask');
    ask.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      ask.close();
      if (b.dataset.tour !== 'no') start(b.dataset.tour);
    });
    for (const b of document.querySelectorAll('#tour-card [data-tour]')) b.addEventListener('click', () => start(b.dataset.tour));
  }

  Object.assign(U, {
    offerTour, wireTour, startTour: start
  });
})();
