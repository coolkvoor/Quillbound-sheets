/* Quillbound Sheets — search the sheet (the magnifier in the top bar; Ctrl+F or / in the installed app, which has no
 * find of its own). Searches what the screens show: features and their folded text and options, actions, spells, gear,
 * magic items, notes, every label with the value typed in it, and the Settings cards. A result unfolds and scrolls to
 * its spot and lights it up for a moment. Changes nothing on the sheet. Shares helpers and state through window.MPMBUI. */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, $$, el } = U;

  // what a result can be, smallest first: a feature, a line in a list, a spell, a field with its label, a stat box, a
  // card's heading. A match inside a smaller one is shown as that one only.
  const UNITS = 'details.feat, li, .skill, .f, .stat, .tg, .card > h3, .fpara';
  const MAX = 60;
  // what players type for the words the screens show ("hp" for the Hit points card): an exact query also finds these,
  // and a unit named so comes first of all
  const ALIASES = {
    hp: ['hit points'], health: ['hit points'], 'temp hp': ['temporary'], thp: ['temporary'], ac: ['armor class'],
    init: ['initiative'], pb: ['proficiency bonus', 'proficiency'], prof: ['proficiency'], hd: ['hit dice'], dc: ['save dc'],
    xp: ['experience'], exp: ['experience'], spd: ['speed'], atk: ['attacks'], str: ['strength'], dex: ['dexterity'],
    con: ['constitution'], int: ['intelligence'], wis: ['wisdom'], cha: ['charisma'], cond: ['conditions'],
    slots: ['spell slots'], ammo: ['ammunition'], money: ['coins'], gold: ['coins'], items: ['magic items', 'equipment']
  };
  // on screen, or folded away (a closed feature), or in Settings (closed while the search is open)
  const shownEl = (n) => !!n && !n.closest('[hidden],[data-absent]') && (n.getClientRects().length > 0 || !!n.closest('details:not([open]), #settings, .card.folded, .card.user-hidden'));   // folded or hidden by the user (ui-arrange.js): found, and shown for a moment
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // a unit's own words: its text plus what is typed in its boxes (an input's text isn't in textContent), without the
  // app's own buttons ("⋯", "Edit")
  function textOf(n) {
    const parts = [];
    const walk = (x) => {
      if (x.nodeType === 3) { parts.push(x.data); return; }
      if (x.nodeType !== 1) return;
      const t = x.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'DATALIST' || t === 'svg' || t === 'SVG') return;
      if (t === 'BUTTON' && !x.dataset.act && !x.classList.contains('dice-chip') && !x.dataset.out && !x.dataset.tour && !x.dataset.skill) return;
      if (x.classList.contains('notes-moved')) return;   // "… are shown with your class features": found there
      // a Notes box shown as a list: its features and paragraphs are found as they are shown, not in the raw text
      if (t === 'TEXTAREA' && x.closest('.notes-f.has-feats')) return;
      if (t === 'INPUT' || t === 'TEXTAREA') { if (x.type !== 'checkbox' && x.type !== 'radio' && x.value) parts.push(' ' + x.value + ' '); return; }
      if (t === 'SELECT') { const o = x.options[x.selectedIndex]; if (o && o.value) parts.push(' ' + o.textContent + ' '); return; }
      for (const c of x.childNodes) walk(c);
      if (/^(P|DIV|LI|SUMMARY|H3|H2|LABEL|DT|DD|SPAN|BUTTON)$/.test(t)) parts.push(' ');
    };
    walk(n);
    return clean(parts.join(''));
  }
  // where a result is: its tab (band) and card, or Settings
  function whereOf(n) {
    const card = n.closest('.card');
    const h = card && card.querySelector(':scope > h3');
    const cardName = h ? clean(h.firstChild && h.firstChild.nodeType === 3 ? h.firstChild.data : h.textContent) : '';
    if (n.closest('#settings')) return { band: 'Settings', card: cardName };
    if (card && card.classList.contains('user-hidden')) return Object.assign(bandOf(n), { card: cardName + ' (hidden card)' });
    return Object.assign(bandOf(n), { card: cardName });
  }
  function bandOf(n) {
    const band = n.closest('section.band');
    const bt = band && band.querySelector('.band-title');
    return { band: bt ? clean(bt.firstChild && bt.firstChild.nodeType === 3 ? bt.firstChild.data : bt.textContent) : '', bandId: band && band.id };
  }
  // a short title for a result: a feature's name, a field's label, a list line's first words
  function titleOf(n, text) {
    if (n.matches('details.feat')) { const f = n.querySelector(':scope > summary .fname'); return f ? f.textContent : text; }
    if (n.matches('.f, .stat')) { const l = n.querySelector('span, .k, .flabel, .lbl, label'); const lt = l ? clean(l.textContent) : ''; return lt || text; }
    if (n.matches('.card > h3')) return text;
    // a line in a list: its first part (an action's name, a gear line's item)
    if (n.matches('li') && n.firstElementChild) { const t = textOf(n.firstElementChild); if (t) return t; }
    return text;
  }
  // what to show under the title: for a feature its description (where the word is, else its start)
  function detailOf(h, q) {
    q = h.term || q;
    if (h.n.matches('details.feat')) {
      const body = h.n.querySelector(':scope > .fbody');
      const d = body ? textOf(body) : '';
      if (d) return norm(d).indexOf(q) !== -1 ? snippet(d, q) : { pre: d.slice(0, 110) + (d.length > 110 ? '…' : ''), hit: '', post: '' };
    }
    return snippet(h.text, q);
  }
  function snippet(text, q) {
    const i = norm(text).indexOf(q);
    if (i < 0) return { pre: text.slice(0, 90), hit: '', post: '' };
    const from = Math.max(0, i - 40), to = Math.min(text.length, i + q.length + 60);
    return { pre: (from ? '…' : '') + text.slice(from, i), hit: text.slice(i, i + q.length), post: text.slice(i + q.length, to) + (to < text.length ? '…' : '') };
  }

  function find(query) {
    const q = norm(clean(query));
    if (q.length < 2) return [];
    const terms = [q].concat(ALIASES[q] || []);
    const scopes = [$('#bands'), $('#settings .panel-body')].filter(Boolean);
    const hits = [];
    for (const scope of scopes) {
      for (const n of scope.querySelectorAll(UNITS)) {
        if (!shownEl(n) || n.closest('#tour, .empty-note')) continue;
        const text = textOf(n);
        if (!text) continue;
        const t = norm(text), term = terms.filter((x) => t.indexOf(x) !== -1).pop();   // an alias's words before the letters typed
        if (!term) continue;
        hits.push({ n, text, term });
      }
    }
    // keep the smallest: drop a unit that holds another hit
    const keep = hits.filter((h) => !hits.some((o) => o !== h && h.n.contains(o.n)))
      .map((h, i) => Object.assign(h, { i, where: whereOf(h.n), title: clean(titleOf(h.n, h.text)) }));
    // in the page's order of tabs; within a tab, what is named so first (the Stealth skill before a line that names it)
    const bandAt = {};
    keep.forEach((h) => { if (!(h.where.band in bandAt)) bandAt[h.where.band] = h.i; });
    const score = (h) => { const t = norm(h.title); return t.indexOf(h.term) === 0 ? 0 : t.indexOf(h.term) !== -1 ? 1 : 2; };
    // a thing named by an alias ("hp" → the Hit points card) goes first, before the page's order
    const named = (h) => (h.top = h.term !== q && score(h) === 0) ? 0 : 1;
    keep.sort((a, b) => named(a) - named(b) || bandAt[a.where.band] - bandAt[b.where.band] || score(a) - score(b) || a.i - b.i);
    return keep.slice(0, MAX);
  }

  // ---------------------------------------------------------------- the panel
  let timer = 0;
  function render() {
    const box = $('#search-results'), q = $('#search-box').value;
    box.textContent = '';
    const res = find(q);
    const qn = norm(clean(q));
    if (qn.length < 2) { box.append(el('p', { cls: 'note', text: 'Type at least two letters: a feature, a spell, an item, a skill…' })); return; }
    if (!res.length) { box.append(el('p', { cls: 'note', text: 'Nothing on this sheet matches “' + clean(q) + '”.' })); return; }
    let band = null;
    res.forEach((r, i) => {
      const group = r.top ? 'Best match' : r.where.band;
      if (group !== band) { band = group; box.append(el('div', { cls: 'search-band', text: band || 'Sheet' })); }
      const sn = detailOf(r, qn);
      const line = el('span', { cls: 'search-snip' }, [document.createTextNode(sn.pre)].concat(sn.hit ? [el('mark', { text: sn.hit })] : [], [document.createTextNode(sn.post)]));
      const head = el('span', { cls: 'search-title' }, [document.createTextNode(r.title.length > 60 ? r.title.slice(0, 60) + '…' : r.title)]);
      if (r.where.card && r.where.card !== r.title) head.append(el('span', { cls: 'search-card', text: r.where.card }));
      const b = el('button', { cls: 'search-hit', type: 'button', 'data-hit': String(i) }, [head, line]);
      b.addEventListener('click', () => jump(r));
      box.append(b);
    });
    if (res.length === MAX) box.append(el('p', { cls: 'note', text: 'Showing the first ' + MAX + '. Type more to narrow it down.' }));
  }
  // close the search, open what the result is in, scroll to it and light it up
  function jump(r) {
    $('#search').close();
    const n = r.n;
    const inSettings = !!n.closest('#settings');
    const go = () => {
      for (let d = n.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
      if (n.matches('details')) n.open = true;
      const c = n.closest('.card.folded, .card.user-hidden');
      if (c && U.peekCard) U.peekCard(c);
      if (r.where.bandId) U.goTo(r.where.bandId);
      requestAnimationFrame(() => {
        n.scrollIntoView({ behavior: U.reduceMotion() ? 'auto' : 'smooth', block: 'center' });
        n.classList.remove('search-flash');
        void n.offsetWidth;
        n.classList.add('search-flash');
        setTimeout(() => n.classList.remove('search-flash'), 2200);
      });
    };
    if (inSettings && !$('#settings').open) { $('#settings-open').click(); setTimeout(go, 50); } else go();
  }
  function open() {
    const d = $('#search');
    if (!d.open) d.showModal();
    const box = $('#search-box');
    box.focus();
    box.select();
    render();
  }

  function wireSearch() {
    const d = $('#search');
    $('#search-open').addEventListener('click', open);
    $('#search-close').addEventListener('click', () => d.close());
    $('#search-box').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
    $('#search-box').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const b = $('#search-results .search-hit'); if (b) b.click(); } });
    // the installed app has no find of its own: Ctrl+F (and / outside a text box) opens this one; in a browser tab
    // Ctrl+F stays the browser's
    const standalone = () => !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    document.addEventListener('keydown', (e) => {
      if ($('#sheet').hidden) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F') && standalone()) { e.preventDefault(); open(); }
      else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !document.querySelector('dialog[open]')) { e.preventDefault(); open(); }
    });
  }

  Object.assign(U, { wireSearch, openSearch: open });
})();
