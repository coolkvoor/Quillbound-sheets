/* Quillbound Sheets — MPMB's dialogs (app.execDialog), drawn from their description. Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, el } = U;

  // ---------------------------------------------------------------- MPMB's dialogs (app.execDialog), drawn from their description
  // The worker sends the dialog's description once, then after every step its values, what is enabled or shown, red
  // text and focus. Each change the user makes is one reply: the values set, the list items picked, and the element
  // whose handler runs (MPMB's code reacts as in Acrobat: filling other boxes, enabling buttons). OK, Cancel and Other
  // end the dialog; a handler can end it too, and a failed validate shows it again.
  const mpmbDialog = (() => {
    let cur = null;          // { id, items: { item_id: { type, node, input, def } }, typed, resolve, waiting }
    const descs = new Map(); // dialog id → description: a dialog opened from another's button comes back to the first
    const dlg = () => $('#mdlg');
    // list objects: { name: n } with n > 0 for the selected item; nested objects are groups (hier_list_box).
    // MPMB numbers items -1, -2, … to put them in order, so they are shown by the size of the number, then as listed.
    const entries = (o) => Object.keys(o || {}).map((k, i) => ({ k, v: o[k], i }))
      .sort((a, b) => (typeof a.v === 'object' || typeof b.v === 'object' ? 0 : Math.abs(Number(a.v)) - Math.abs(Number(b.v))) || a.i - b.i);
    const chosen = (o) => { for (const e of entries(o)) { if (e.v && typeof e.v === 'object') { const c = chosen(e.v); if (c !== null) return c; } else if (Number(e.v) > 0) return e.k; } return null; };
    // MPMB writes line breaks in its dialog texts as "\n", sometimes as "\r" (Acrobat shows both)
    const textOf = (s) => String(s === undefined || s === null ? '' : s).replace(/\r\n?/g, '\n');
    // MPMB ends list items with their source in superscript characters ("Paladin ˢʳᵈ'²⁴"). The app's fonts lack most
    // of them, so the phone took each from another font at its own size and height. Shown here as plain letters in a
    // small label instead; the item's name sent back to MPMB stays as it is.
    const SUP = 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾';
    const PLAIN = 'abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVW0123456789+-=()';
    const SUP_TAIL = new RegExp('^(.*?\\S)\\s*([' + SUP + '][' + SUP + "'’ʼ.,:;\\- ]*)$");
    function splitSource(name) {
      const m = SUP_TAIL.exec(name);
      if (!m || !/[^'’ʼ.,:;\- ]$/.test(m[2])) return null;
      return { text: m[1], src: Array.from(m[2]).map((c) => { const i = SUP.indexOf(c); return i === -1 ? (c === 'ʼ' ? '’' : c) : PLAIN[i]; }).join('') };
    }
    // a list item's or group's label: the name, and its source as a small label
    const itemLabel = (name) => {
      const p = splitSource(name);
      return p ? [document.createTextNode(p.text), el('span', { cls: 'md-src', text: p.src })] : [document.createTextNode(name.trim() ? name : '–')];
    };
    // the same for a drop-down's options, which can only hold text (capitals, as the label's small caps show it)
    const optionText = (name) => { const p = splitSource(name); return p ? p.text + ' (' + p.src.toUpperCase() + ')' : name.trim() ? name : '–'; };

    // MPMB's source dialogs (Source Selection and the single-item dialogs) move items between an Excluded list (ExcL)
    // and an Included list (IncL) with >>, >, < and <<. Acrobat has the lists side by side; on a phone they are stacked,
    // so the arrows pointed nowhere and ">>" wasn't read as "include all". Same buttons, named for what they do.
    const MOVERS = { BTRA: 'Include all', BTR1: 'Include ↓', BTL1: '↑ Exclude', BTLA: 'Exclude all' };
    const hasPair = (desc) => { const ids = new Set(); const w = (e) => { if (!e) return; if (e.item_id) ids.add(e.item_id); (e.elements || []).forEach(w); }; w(desc); return ids.has('ExcL') && ids.has('IncL'); };
    const LONG_LIST = 20;
    // show the items (and their groups) that hold the searched text
    function filterList(it) {
      const q = it.find.value.trim().toLowerCase();
      const depth = (li) => Number(li.style.getPropertyValue('--d')) || 0;
      const open = [];   // the groups above the current item; a group shows when anything under it does
      const done = (g) => { g.hidden = !g.dataset.hit; delete g.dataset.hit; };
      let shown = 0, total = 0;
      for (const li of it.input.children) {
        if (li.classList.contains('md-group')) {
          while (open.length && depth(open[open.length - 1]) >= depth(li)) done(open.pop());
          open.push(li);
        } else if (li.dataset.item) {
          total++;
          const hit = !q || li.textContent.toLowerCase().indexOf(q) !== -1;
          li.hidden = !hit;
          if (hit) { shown++; for (const g of open) g.dataset.hit = '1'; }
        }
      }
      while (open.length) done(open.pop());
      it.count.textContent = q ? shown + ' of ' + total : total + (total === 1 ? ' item' : ' items');
      let none = it.input.querySelector('.md-none');
      if (total && !shown) { if (!none) it.input.append(el('li', { cls: 'md-none', text: 'Nothing matches' })); } else if (none && total) none.remove();
    }

    function send(reply) {
      if (!cur || !cur.resolve || cur.waiting) return;
      // text boxes typed in but not yet sent go along with every reply
      const set = Object.assign({}, cur.typed, reply.set || {});
      cur.typed = {};
      const r = cur.resolve;
      cur.resolve = null;
      cur.waiting = true;
      dlg().classList.add('waiting');
      r(Object.assign({}, reply, { set }));
      // OK, Cancel and Other: the dialog stays on screen (taps blocked) until MPMB is done (idle) or shows the next
      // dialog, or this one again when its validate fails. Closing at once showed the page between two dialogs.
      if (reply.press === 'ok' || reply.press === 'cancel' || reply.press === 'other') {
        const was = cur;
        setTimeout(() => { if (cur === was && cur.waiting) mpmbDialog.idle(); }, ENDED_MS);
      }
    }
    function close() { const d = dlg(); if (d.open) d.close(); }
    const ENDED_MS = 8000;   // a dialog that was answered closes by itself after this, should no idle() come

    function build(req) {
      const d = dlg();
      const body = $('#mdlg-body'), foot = $('#mdlg-foot');
      body.textContent = ''; foot.textContent = '';
      const items = {};
      const title = req.desc && req.desc.name ? textOf(req.desc.name) : req.name;
      $('#mdlg-title').textContent = title.length > 60 ? req.name : title;
      const walk = (e, parent) => {
        // MPMB places a second set of buttons "align_offscreen" (Acrobat draws it outside the dialog) so Esc closes it
        if (!e || e.alignment === 'align_offscreen') return;
        const t = e.type || 'view';
        let node = null;
        if (t === 'view' || t === 'cluster') {
          node = el(t === 'cluster' ? 'fieldset' : 'div', { cls: 'md-' + t + (e.align_children === 'align_row' ? ' md-row' : '') });
          if (t === 'cluster' && e.name) node.append(el('legend', { text: textOf(e.name) }));
          for (const c of e.elements || []) walk(c, node);
        } else if (t === 'static_text' || t === 'link_text') {
          node = el('p', { cls: 'md-text' + (e.bold || e.font === 'heading' || e.font === 'title' ? ' md-bold' : '') + (e.font === 'title' ? ' md-title' : '') + (e.italic ? ' md-italic' : ''), text: textOf(e.name) });
        } else if (t === 'edit_text') {
          const lab = e.name ? el('span', { cls: 'md-label', text: textOf(e.name) }) : null;
          const input = e.multiline ? el('textarea', { cls: 'in', rows: String(Math.max(2, Math.min(12, Math.round((e.char_height || (e.height ? e.height / 14 : 4)))))) }) : el('input', { cls: 'in', type: e.password ? 'password' : 'text' });
          if (e.SpinEdit) input.setAttribute('inputmode', 'decimal');
          if (e.readonly) input.readOnly = true;
          input.setAttribute('aria-label', textOf(e.name) || e.item_id || 'Text');
          input.addEventListener('input', () => { if (cur) cur.typed[e.item_id] = input.value; });
          input.addEventListener('change', () => send({ set: { [e.item_id]: input.value }, press: e.item_id }));
          node = el('label', { cls: 'md-field' }, lab ? [lab, input] : [input]);
          items[e.item_id] = { type: t, node, input, def: e };
        } else if (t === 'popup') {
          const input = el('select', { cls: 'in', 'aria-label': textOf(e.name) || e.item_id });
          input.addEventListener('change', () => send({ pick: { [e.item_id]: input.value }, press: e.item_id }));
          node = el('label', { cls: 'md-field' }, e.name ? [el('span', { cls: 'md-label', text: textOf(e.name) }), input] : [input]);
          items[e.item_id] = { type: t, node, input, def: e };
        } else if (t === 'list_box' || t === 'hier_list_box') {
          const input = el('ul', { cls: 'md-list', role: 'listbox', 'aria-label': textOf(e.name) || e.item_id });
          input.addEventListener('click', (ev) => {
            const li = ev.target.closest('li[data-item]');
            if (!li || li.getAttribute('aria-disabled') === 'true') return;
            send({ pick: { [e.item_id]: li.dataset.item }, press: e.item_id });
          });
          // a long list gets a search box and its count (the app's own: MPMB only sees the item picked)
          const find = el('input', { cls: 'in md-find', type: 'search', placeholder: 'Search', 'aria-label': 'Search ' + (textOf(e.name) || 'the list'), autocomplete: 'off', spellcheck: 'false' });
          const count = el('span', { cls: 'md-count hint' });
          find.addEventListener('input', () => filterList(items[e.item_id]));
          const tools = el('div', { cls: 'md-find-row', hidden: '' }, [find, count]);
          node = el('div', { cls: 'md-field' }, (e.name ? [el('span', { cls: 'md-label', text: textOf(e.name) })] : []).concat([tools, input]));
          items[e.item_id] = { type: t, node, input, def: e, find, count, tools };
        } else if (t === 'check_box' || t === 'radio') {
          const input = el('input', { type: t === 'radio' ? 'radio' : 'checkbox' });
          if (t === 'radio') input.name = 'md-' + req.id + '-' + (e.group_id || 'g');
          input.addEventListener('change', () => {
            const set = { [e.item_id]: input.checked };
            // a radio group: the others go off
            if (t === 'radio') for (const k of Object.keys(items)) if (k !== e.item_id && items[k].type === 'radio' && (items[k].def.group_id || 'g') === (e.group_id || 'g')) set[k] = false;
            send({ set, press: e.item_id });
          });
          node = el('label', { cls: 'md-check' }, [input, el('span', { text: textOf(e.name) })]);
          items[e.item_id] = { type: t, node, input, def: e };
        } else if (t === 'button') {
          node = el('button', { cls: 'btn md-btn', type: 'button', text: MOVERS[e.item_id] && hasPair(req.desc) ? MOVERS[e.item_id] : textOf(e.name) || e.item_id });
          if (MOVERS[e.item_id] && hasPair(req.desc)) node.setAttribute('aria-label', MOVERS[e.item_id].replace(/[↑↓] ?| ?[↑↓]/g, ''));
          node.addEventListener('click', () => send({ press: e.item_id }));
          items[e.item_id] = { type: t, node, input: node, def: e };
        } else if (t === 'ok' || t === 'ok_cancel' || t === 'ok_cancel_other') {
          const mk = (label, press, primary) => { const b = el('button', { cls: 'btn' + (primary ? ' primary' : ''), type: 'button', text: label }); b.addEventListener('click', () => send({ press })); return b; };
          if (t !== 'ok') foot.append(mk(textOf(e.cancel_name) || 'Cancel', 'cancel'));
          if (t === 'ok_cancel_other') foot.append(mk(textOf(e.other_name) || 'Other', 'other'));
          foot.append(mk(textOf(e.ok_name) || 'OK', 'ok', true));
          if (e.item_id) items[e.item_id] = { type: t, node: foot, input: foot, def: e };
          return;
        } else if (t === 'gap') {
          node = el('div', { cls: 'md-gap' });
        } else {
          return;   // images: MPMB's icons, left out
        }
        if (e.item_id && !items[e.item_id]) items[e.item_id] = { type: t, node, input: null, def: e };
        parent.append(node);
      };
      walk(req.desc, body);
      // the source dialogs' move buttons: in one row between the two lists, which stack on a phone
      if (items.BTRA && hasPair(req.desc)) {
        const v = items.BTRA.node.parentNode;
        v.classList.add('md-movers');
        if (v.parentNode) v.parentNode.classList.add('md-pair');
      }
      // a dialog without OK/Cancel buttons can still be closed
      if (!foot.childElementCount) { const b = el('button', { cls: 'btn primary', type: 'button', text: 'Close' }); b.addEventListener('click', () => send({ press: 'cancel' })); foot.append(b); }
      d.oncancel = (ev) => { ev.preventDefault(); send({ press: 'cancel' }); };
      return items;
    }

    function fill(req) {
      const items = cur.items;
      for (const id of Object.keys(items)) {
        const it = items[id], v = req.values[id], list = req.lists && req.lists[id];
        if (it.type === 'static_text' && typeof v === 'string') it.node.textContent = v;
        else if (it.type === 'button' && typeof v === 'string' && v) it.node.textContent = v;
        else if (it.type === 'edit_text') {
          // a text box loaded with a list is a drop-down
          if (list && it.input.tagName !== 'SELECT') {
            const sel = el('select', { cls: 'in', 'aria-label': it.input.getAttribute('aria-label') });
            sel.addEventListener('change', () => send({ set: { [id]: sel.value }, press: id }));
            it.input.replaceWith(sel); it.input = sel;
          }
          if (list) {
            it.input.textContent = '';
            const names = entries(list).map((x) => x.k);
            if (v && names.indexOf(String(v)) === -1) names.unshift(String(v));
            for (const n of names) it.input.append(el('option', { value: n, text: optionText(n) }));
          }
          if (document.activeElement !== it.input || !(id in cur.typed)) it.input.value = v === undefined || v === null ? '' : String(v);
        } else if (it.type === 'popup') {
          it.input.textContent = '';
          for (const x of entries(v)) it.input.append(el('option', { value: x.k, text: optionText(x.k) }));
          const c = chosen(v);
          if (c !== null) it.input.value = c;
        } else if (it.type === 'list_box' || it.type === 'hier_list_box') {
          const ul = it.input, top = ul.scrollTop;
          ul.textContent = '';
          const add = (o, depth) => {
            for (const x of entries(o)) {
              if (x.v && typeof x.v === 'object') { ul.append(el('li', { cls: 'md-group', style: '--d:' + depth }, itemLabel(x.k))); add(x.v, depth + 1); continue; }
              const on = Number(x.v) > 0;
              ul.append(el('li', { 'data-item': x.k, role: 'option', 'aria-selected': on ? 'true' : 'false', style: '--d:' + depth }, itemLabel(x.k)));
            }
          };
          add(v, 0);
          const n = ul.querySelectorAll('li[data-item]').length;
          if (!n) ul.append(el('li', { cls: 'md-none', text: 'Nothing here' }));
          it.tools.hidden = n <= LONG_LIST && !it.find.value;
          if (!it.tools.hidden) filterList(it);
          ul.scrollTop = top;
        } else if (it.type === 'check_box' || it.type === 'radio') it.input.checked = !!v;
      }
      // enabled / shown / red, as the handlers set them
      for (const id of Object.keys(items)) {
        const it = items[id];
        if (it.type === 'ok' || it.type === 'ok_cancel' || it.type === 'ok_cancel_other') continue;
        const on = req.enabled[id] !== false;
        if (it.input) { it.input.disabled = !on; if (it.input.tagName === 'UL') it.input.classList.toggle('off', !on); }
        it.node.classList.toggle('md-off', !on);
        it.node.hidden = req.shown[id] === false;
        it.node.classList.toggle('md-red', req.red.indexOf(id) !== -1);
      }
      if (req.focus && items[req.focus] && items[req.focus].input && items[req.focus].input.focus) {
        const f = items[req.focus].input;
        if (f.tagName === 'UL') { const s = f.querySelector('[aria-selected="true"]'); if (s) s.scrollIntoView({ block: 'nearest' }); } else f.focus({ preventScroll: true });
      }
    }

    return {
      // one request from the worker: build the dialog (first time) or update it; resolves with the user's reply
      show(req) {
        return new Promise((resolve) => {
          if (req.desc) descs.set(req.id, req.desc);
          if (!cur || cur.id !== req.id || req.desc) {
            close();
            cur = { id: req.id, items: null, typed: {}, resolve: null, waiting: false };
            cur.items = build(Object.assign({}, req, { desc: descs.get(req.id) || { elements: [] } }));
          }
          cur.resolve = resolve;
          cur.waiting = false;
          dlg().classList.remove('waiting');
          fill(req);
          if (!dlg().open) { dlg().showModal(); $('#mdlg-body').scrollTop = 0; }
        });
      },
      // the worker finished its request: a dialog still on screen (ended by one of its handlers) is over
      idle() { if (cur && cur.waiting) { close(); cur = null; descs.clear(); } },
    };
  })();

  Object.assign(U, {
    mpmbDialog
  });
})();
