/* Quillbound Sheets — suggestions under a text box, drawn by the app instead of the browser's <datalist> popup.
   Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { el } = U;

  // Boxes with MPMB's lists (magic items, feats, weapons, damage types, ammunition, creatures) keep their <datalist>
  // (filled by the data-items binding), but the browser's own popup isn't used: Brave on Android drew it over the page
  // without a background, and it can't be styled. On focus a box's `list` moves to data-list and this list shows
  // the matching names under it; a tap fills the box and sends a change, as picking from the datalist did.
  const MAX = 60;
  let box = null, input = null;

  function panel() {
    if (!box) {
      box = el('ul', { cls: 'suggest', role: 'listbox', hidden: '' });
      // pointerdown, not click: the box must not lose focus (and the list close) before the pick
      box.addEventListener('pointerdown', (e) => {
        const li = e.target.closest('li[data-v]');
        if (!li) return;
        e.preventDefault();
        pick(li.dataset.v);
      });
      document.body.append(box);
    }
    return box;
  }
  function names(inp) {
    const dl = document.getElementById(inp.dataset.list);
    return dl ? Array.from(dl.options).map((o) => o.value).filter(Boolean) : [];
  }
  // names starting with what was typed first, then names with a word starting with it, then any that contain it
  function matches(all, typed) {
    const q = typed.trim().toLowerCase();
    if (!q) return all.slice(0, MAX);
    const a = [], b = [], c = [];
    for (const n of all) {
      const l = n.toLowerCase();
      if (l === q) continue;
      if (l.startsWith(q)) a.push(n);
      else if (l.indexOf(' ' + q) !== -1 || l.indexOf('(' + q) !== -1) b.push(n);
      else if (l.indexOf(q) !== -1) c.push(n);
    }
    return a.concat(b, c).slice(0, MAX);
  }
  function show() {
    if (!input) return;
    const p = panel();
    const list = matches(names(input), input.value);
    p.textContent = '';
    for (const n of list) p.append(el('li', { role: 'option', 'data-v': n, text: n }));
    if (!list.length || input.readOnly) { p.hidden = true; return; }
    // under the box, in page coordinates, so it scrolls with the page; above it when there's more room there
    const r = input.getBoundingClientRect();
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const below = vh - r.bottom, above = r.top;
    const up = below < 180 && above > below;
    p.style.left = (r.left + window.scrollX) + 'px';
    p.style.width = r.width + 'px';
    p.style.maxHeight = Math.max(120, Math.min(320, (up ? above : below) - 12)) + 'px';
    p.hidden = false;
    p.style.top = (up ? r.top + window.scrollY - p.offsetHeight - 4 : r.bottom + window.scrollY + 4) + 'px';
    p.scrollTop = 0;
  }
  function hide() { if (box) box.hidden = true; }
  function pick(v) {
    const inp = input;
    if (!inp) return;
    inp.value = v;
    hide();
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    // leaving the box sends the browser's own change when the value differs from when it got focus; send one only
    // when it doesn't (picking the value it already had), so MPMB never gets the pick twice
    let sent = false;
    const seen = () => { sent = true; };
    inp.addEventListener('change', seen);
    inp.blur();
    inp.removeEventListener('change', seen);
    if (!sent) inp.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function wireSuggest() {
    document.addEventListener('focusin', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.hasAttribute('list')) { t.dataset.list = t.getAttribute('list'); t.removeAttribute('list'); }
      if (!t.dataset.list) return;
      input = t;
      show();
    });
    document.addEventListener('input', (e) => { if (e.target === input) show(); });
    document.addEventListener('focusout', (e) => { if (e.target === input) { input = null; hide(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input && box && !box.hidden) { e.preventDefault(); hide(); } });
    // the keyboard opening or the page resizing moves the box
    const again = () => { if (input && box && !box.hidden) show(); };
    window.addEventListener('resize', again);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', again);
  }

  Object.assign(U, { wireSuggest });
})();
