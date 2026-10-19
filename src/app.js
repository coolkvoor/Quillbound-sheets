/* MPMB Sheet App 0.1 — the screens. All MPMB logic runs in worker.js; this file shows fields and sends taps. */
(() => {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const el = (tag, attrs, kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'cls') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach((c) => n.append(c));
    return n;
  };
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ABILITIES = [['Str', 'Strength'], ['Dex', 'Dexterity'], ['Con', 'Constitution'], ['Int', 'Intelligence'], ['Wis', 'Wisdom'], ['Cha', 'Charisma']];
  const SKILLS = [['Acr', 'Acrobatics', 'Dex'], ['Ani', 'Animal Handling', 'Wis'], ['Arc', 'Arcana', 'Int'], ['Ath', 'Athletics', 'Str'], ['Dec', 'Deception', 'Cha'], ['His', 'History', 'Int'], ['Ins', 'Insight', 'Wis'], ['Inti', 'Intimidation', 'Cha'], ['Inv', 'Investigation', 'Int'], ['Med', 'Medicine', 'Wis'], ['Nat', 'Nature', 'Int'], ['Perc', 'Perception', 'Wis'], ['Perf', 'Performance', 'Cha'], ['Pers', 'Persuasion', 'Cha'], ['Rel', 'Religion', 'Int'], ['Sle', 'Sleight of Hand', 'Dex'], ['Ste', 'Stealth', 'Dex'], ['Sur', 'Survival', 'Wis']];
  const ATTACKS = 6, LIMITED = 8, FEATS = 5, HITDICE = 3;
  // suggestions for the language lines (the 2024 standard and rare languages); MPMB has no list of them
  const LANGUAGES = ['Common', 'Common Sign Language', 'Draconic', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc',
    'Abyssal', 'Celestial', 'Deep Speech', 'Druidic', 'Infernal', 'Primordial', 'Sylvan', 'Thieves’ Cant', 'Undercommon'];
  const APP_BUILD = 'development build';   // tools/build-single.js puts the version and build time here
  const ACTIONS = [['Action', 16, 'Action'], ['Bonus Action', 6, 'Bonus action'], ['Reaction', 6, 'Reaction']];

  // content: what MPMB has loaded (files, pasted script, sources); saved: the fields that hold it, kept per sheet
  const state = { worker: null, bytes: null, fileName: '', sheetKey: '', snap: new Map(), info: null, stats: null, log: null, busy: 0, content: null, saved: null };

  // ---------------------------------------------------------------- worker connection
  // Chrome refuses blob: workers on pages opened from a file (file://); a data: URL may still work there
  function newWorker() {
    try { return new Worker(window.MPMB_WORKER_URL || 'worker.js'); } catch (e) {
      const src = document.getElementById('mpmb-worker-src');
      if (src) { try { return new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(src.textContent)); } catch (e2) { /* fall through */ } }
      throw new Error('WORKER_FAILED: ' + (location.protocol === 'file:' ? 'FILE_PAGE' : (e && e.message) || 'no worker'));
    }
  }
  // Safety net: MPMB's code can get stuck in a loop (its AddToNotes does with 3+ Notes pages), and then the engine never
  // answers. A request that runs past its limit calls onStuck (the app restarts the engine from the autosave).
  // The limits are far above normal (most requests take well under a second, opening a sheet ~10 s on a phone).
  const SLOW_OPS = { open: 300, savePdf: 300, addContent: 300, removeContent: 300, setSources: 300, setUserScript: 300, chooseSpells: 180 };
  const LIMIT_S = 60;
  // MPMB's dialogs and questions: the worker waits (Atomics.wait) on memory shared with this page until the user has
  // answered (onAsk). Shared memory needs a cross-origin isolated page; without it dialogs keep their defaults.
  const ASK_BYTES = 4 * 1048576;
  const canAsk = () => !!(self.crossOriginIsolated && typeof SharedArrayBuffer === 'function' && typeof Atomics === 'object');
  function connect() {
    const w = newWorker();
    const pending = new Map();
    let seq = 0, stuck = false, asking = 0;
    const sab = canAsk() ? new SharedArrayBuffer(8 + ASK_BYTES) : null;
    const flag = sab ? new Int32Array(sab, 0, 2) : null, bytes = sab ? new Uint8Array(sab, 8) : null;
    function answerAsk(reply) {
      let b = new TextEncoder().encode(JSON.stringify(reply === undefined ? null : reply));
      if (b.length > ASK_BYTES) b = new TextEncoder().encode('null');
      bytes.set(b);
      Atomics.store(flag, 1, b.length);
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
    }
    const api = {
      onProgress: null,
      onStuck: null,
      onAsk: null,      // (request) → Promise of the user's reply
      onIdle: null,     // a request finished: a dialog still on screen is over
      asks: !!sab,
      call(op, args, transfer) {
        const id = ++seq;
        return new Promise((resolve, reject) => {
          // the time limit doesn't count while the user is answering one of MPMB's dialogs
          let timer = 0;
          const arm = () => { timer = setTimeout(() => {
            if (stuck || !pending.has(id)) return;
            if (asking) { arm(); return; }
            stuck = true;
            if (api.onStuck) api.onStuck(op); else api.terminate();
          }, (SLOW_OPS[op] || LIMIT_S) * 1000); };
          arm();
          pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
          w.postMessage({ id, op, args }, transfer || []);
        });
      },
      terminate() { w.terminate(); for (const p of pending.values()) p.reject(new Error('stopped')); pending.clear(); },
    };
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'progress') { if (api.onProgress) api.onProgress(m.text); return; }
      if (m.type === 'ready') return;
      if (m.type === 'ask') {
        asking++;
        Promise.resolve(api.onAsk ? api.onAsk(m.req) : null).catch(() => null)
          .then((r) => { asking--; answerAsk(r); });
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (api.onIdle) api.onIdle();
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    };
    if (sab) api.call('channel', { sab }).then((r) => { if (!r || !r.ok) api.asks = false; }, () => { api.asks = false; });
    w.onerror = (e) => { const err = new Error('WORKER_FAILED: ' + (e.message || 'the sheet engine could not start')); for (const p of pending.values()) p.reject(err); pending.clear(); e.preventDefault && e.preventDefault(); };
    return api;
  }

  // ---------------------------------------------------------------- remembering the last PDF on this device
  const DB = 'mpmb-sheet-app', STORE = 'files';
  function idb() {
    return new Promise((resolve, reject) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      } catch (e) { reject(e); }
    });
  }
  async function idbGet(key) { try { const db = await idb(); return await new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return null; } }
  async function idbDel(key) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { /* storage may be unavailable */ } }
  async function idbPut(key, val) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { /* storage may be unavailable */ } }

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
      if (reply.press === 'ok' || reply.press === 'cancel' || reply.press === 'other') close();
    }
    function close() { const d = dlg(); if (d.open) d.close(); }

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
          node = el('div', { cls: 'md-field' }, e.name ? [el('span', { cls: 'md-label', text: textOf(e.name) }), input] : [input]);
          items[e.item_id] = { type: t, node, input, def: e };
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
          node = el('button', { cls: 'btn md-btn', type: 'button', text: textOf(e.name) || e.item_id });
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
            for (const n of names) it.input.append(el('option', { value: n, text: n.trim() ? n : '–' }));
          }
          if (document.activeElement !== it.input || !(id in cur.typed)) it.input.value = v === undefined || v === null ? '' : String(v);
        } else if (it.type === 'popup') {
          it.input.textContent = '';
          for (const x of entries(v)) it.input.append(el('option', { value: x.k, text: x.k.trim() ? x.k : '–' }));
          const c = chosen(v);
          if (c !== null) it.input.value = c;
        } else if (it.type === 'list_box' || it.type === 'hier_list_box') {
          const ul = it.input, top = ul.scrollTop;
          ul.textContent = '';
          const add = (o, depth) => {
            for (const x of entries(o)) {
              if (x.v && typeof x.v === 'object') { ul.append(el('li', { cls: 'md-group', style: '--d:' + depth, text: x.k })); add(x.v, depth + 1); continue; }
              const on = Number(x.v) > 0;
              ul.append(el('li', { 'data-item': x.k, role: 'option', 'aria-selected': on ? 'true' : 'false', style: '--d:' + depth, text: x.k.trim() ? x.k : '–' }));
            }
          };
          add(v, 0);
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

  // ---------------------------------------------------------------- start screen
  const startErr = $('#start-error');
  function showError(msg) { startErr.textContent = msg; startErr.hidden = false; }
  function friendlyError(e) {
    const m = String(e && e.message || e);
    if (/EVAL_BLOCKED/.test(m)) return 'This viewer doesn’t allow the sheet’s scripts to run, so the app can’t start here. Tell Claude: EVAL_BLOCKED.';
    if (/NOT_MPMB/.test(m)) return 'This PDF doesn’t look like an MPMB character sheet. Pick an MPMB 2024 sheet PDF.';
    if (/FILE_PAGE/.test(m)) return 'Chrome doesn’t let this app run when it’s opened straight from a file on your computer. Open it from its web link, or through the local test server.';
    if (/WORKER_FAILED/.test(m)) return 'The sheet engine couldn’t start in this browser (' + m.replace('WORKER_FAILED: ', '') + '). Try Chrome, or tell Claude what you see.';
    if (/Failed to parse|Invalid PDF|No PDF header/i.test(m)) return 'This file couldn’t be read as a PDF.';
    return 'Something went wrong while opening the sheet: ' + m;
  }
  async function initStart() {
    const last = await idbGet('last');
    const btn = $('#reopen');
    if (last && last.blob) {
      btn.textContent = 'Reopen ' + last.name;
      btn.hidden = false;
      btn.onclick = async () => { const buf = await last.blob.arrayBuffer(); openSheet(buf, last.name, false); };
    }
    // onchange, not addEventListener: initStart runs again for "Open another sheet"
    $('#file').onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const buf = await f.arrayBuffer();
      e.target.value = '';
      openSheet(buf, f.name, true);
    };
  }

  async function openSheet(buf, name, remember) {
    startErr.hidden = true;
    $('#start-actions').hidden = true;
    const loading = $('#loading');
    loading.hidden = false;
    $('#loading-text').textContent = 'Reading the PDF';
    $('#loading-sub').textContent = name + ' · ' + (buf.byteLength / 1048576).toFixed(1) + ' MB';
    if (state.worker) state.worker.terminate();
    dropSpare();
    state.modelJSON = null;
    state.snap.clear();
    state.bytes = buf.slice(0);
    state.fileName = name;
    state.sheetKey = 'content:' + name + '|' + buf.byteLength;   // add-on content belongs to this sheet file
    state.charKey = 'char:' + name + '|' + buf.byteLength;       // and so does the autosaved character
    const stored = await idbGet(state.sheetKey);
    const char = await idbGet(state.charKey);
    state.savedAt = char && char.date ? char.date : 0;
    let w = null;
    const t0 = performance.now();
    try {
      w = connect();
      state.worker = w;
      wireWorker(w);
      const res = await w.call('open', { bytes: buf, fileName: name, saved: stored && stored.saved ? stored.saved : null, state: char && char.state ? char.state : null }, [buf]);
      if (T) T.sheet({ look: /printer friendly/i.test(res.info.type) ? 'pf' : 'colorful' });
      state.info = res.info; state.stats = res.stats; state.stats.openMs = Math.round(performance.now() - t0); state.log = res.log;
      state.content = res.content; state.saved = res.saved;
      // MPMB drops an add-on that fails at startup; keep what it kept
      if (stored && stored.saved && JSON.stringify(stored.saved) !== JSON.stringify(res.saved)) idbPut(state.sheetKey, { saved: res.saved, date: Date.now() });
      if (remember) idbPut('last', { name, blob: new Blob([state.bytes], { type: 'application/pdf' }), date: Date.now() });
      await showSheet();
      // without a page that can wait (cross-origin isolated), MPMB's dialogs work by restart and replay: get the sheet
      // model for fresh copies and make a spare one ready in the background
      if (!w.asks) w.call('modelJSON', {}).then((m) => { if (state.worker === w) { state.modelJSON = m; setTimeout(makeSpare, 1500); } }, () => {});
    } catch (e) {
      if (w) w.terminate();
      state.worker = null;
      loading.hidden = true; $('#start-actions').hidden = false;
      showError(friendlyError(e));
    }
  }

  // ---------------------------------------------------------------- when MPMB gets stuck
  // Stop the engine and open the sheet again with the autosaved character: what was saved before the change that got
  // stuck (that change never finished, so it was never saved). Then offer to clear the Notes pages, the known cause.
  let recovering = false;
  async function recoverFromStuck(op) {
    if (recovering) return;
    recovering = true;
    clearTimeout(saveTimer); saveTimer = 0;
    const w = state.worker;
    state.worker = null;
    if (w) w.terminate();
    state.busy = 0; setBusy(0);
    for (const d of $$('dialog[open]')) d.close();
    toast('MPMB stopped responding. Reopening your character…');
    try {
      await openSheet(state.bytes.slice(0), state.fileName, false);
      await refreshPages();
      const notes = (state.pages || []).filter((p) => p.key === 'ASnotes')[0];
      $('#stuck-op').textContent = OP_NAMES[op] || op;
      $('#stuck-notes').hidden = !(notes && notes.prefixes.length);
      $('#stuck').showModal();
    } finally { recovering = false; }
  }
  const OP_NAMES = { commit: 'a change to a field', toggle: 'a tick box', press: 'a button', tap: 'a button or menu', applyClasses: 'changing your class', chooseSpells: 'choosing spells', removeSpells: 'removing the spell list', addContent: 'adding content', setSources: 'changing sources', applyAbilities: 'changing ability scores', rebuildClassText: 'rebuilding the feature texts', exportState: 'saving' };

  // Clearing out the Notes pages (MPMB's own removal of all of them); their text is shown first, to copy what to keep
  async function clearNotesPages() {
    const pages = await state.worker.call('notesText', {});
    const box = $('#notes-clear-text');
    box.textContent = '';
    const all = [];
    for (const p of pages) for (const t of [p.left, p.right]) if (t.trim()) all.push(t.trim());
    box.value = all.length ? all.join('\n\n——\n\n') : '';
    $('#notes-clear-empty').hidden = !!all.length;
    box.hidden = !all.length;
    $('#notes-clear-count').textContent = pages.length + (pages.length === 1 ? ' Notes page' : ' Notes pages');
    const dlg = $('#notes-clear');
    const yes = await new Promise((resolve) => {
      let ok = false;
      $('#notes-clear-copy').onclick = async () => { try { await navigator.clipboard.writeText(box.value); toast('Copied'); } catch (e) { box.select(); } };
      $('#notes-clear-yes').onclick = () => { ok = true; dlg.close(); };
      $('#notes-clear-no').onclick = () => dlg.close();
      dlg.onclose = () => resolve(ok);
      dlg.showModal();
    });
    if (!yes) return;
    await send('clearNotesPages', {});
    await refreshPages();
    toast('Notes pages removed');
  }

  // ---------------------------------------------------------------- building the screens
  // the sheet's advantage / disadvantage marks (MPMB's check boxes "<x> Adv" and "<x> Dis"; ticking one clears the other)
  const advDis = (pre, label) => el('span', { cls: 'ad' }, [
    el('button', { type: 'button', 'data-toggle': pre + ' Adv', 'aria-pressed': 'false', 'aria-label': label + ': advantage', title: 'Advantage', text: 'A' }),
    el('button', { type: 'button', 'data-toggle': pre + ' Dis', 'aria-pressed': 'false', 'aria-label': label + ': disadvantage', title: 'Disadvantage', text: 'D' }),
  ]);
  // a drop-down of one of MPMB's combo boxes whose items are [value, shown] pairs
  const abilitySelect = (field, label, empty) => el('select', { cls: 'in', 'data-f': field, id: 'f-' + field.replace(/\W+/g, '-'), 'aria-label': label },
    [[empty, '–'], ['Str Mod', 'Str'], ['Dex Mod', 'Dex'], ['Con Mod', 'Con'], ['Int Mod', 'Int'], ['Wis Mod', 'Wis'], ['Cha Mod', 'Cha']].map(([v, t]) => el('option', { value: v, text: t })));
  function buildAbilities() {
    const box = $('#abilities');
    box.textContent = '';
    for (const [k, long] of ABILITIES) {
      const save = el('div', { cls: 'save' }, [
        el('button', { cls: 'dot sm', type: 'button', 'data-toggle': k + ' ST Prof', 'aria-pressed': 'false', 'aria-label': long + ' saving throw proficiency' }),
        el('span', { text: 'Save ' }), el('b', { cls: 'num', 'data-out': k + ' ST Mod', text: '–' }),
      ]);
      box.append(el('div', { cls: 'abi' }, [
        el('span', { cls: 'k', text: k.toUpperCase(), title: long }),
        el('span', { cls: 'mod num', 'data-out': k + ' Mod', text: '–' }),
        el('input', { 'data-f': k, id: 'f-abi-' + k, inputmode: 'numeric', autocomplete: 'off', 'aria-label': long + ' score', cls: 'num' }),
        save,
        // the sheet's two small Adv / Dis boxes beside the save; on their own line here, as a box is too narrow on a phone
        advDis(k + ' ST', long + ' save'),
      ]));
    }
  }
  function buildSkills() {
    const box = $('#skills');
    box.textContent = '';
    for (const [f, name, abi] of SKILLS) {
      box.append(el('div', { cls: 'skill' }, [
        el('button', { cls: 'dot sm', type: 'button', 'data-skill': f, 'aria-pressed': 'false', 'aria-label': name + ' proficiency' }),
        el('span', { cls: 'n', text: name }),
        el('span', { cls: 'a', text: abi }),
        advDis(f, name),
        el('span', { cls: 'v num', 'data-out': f, text: '–' }),
      ]));
    }
    // the sheet's tool or custom skill line: MPMB takes its ability from the name, such as "Thieves' Tools (Dex)"
    box.append(el('div', { cls: 'skill tool' }, [
      el('button', { cls: 'dot sm', type: 'button', 'data-skill': 'Too', 'aria-pressed': 'false', 'aria-label': 'Tool proficiency' }),
      el('input', { cls: 'in n', 'data-f': 'Too Text', id: 'f-too-text', autocomplete: 'off', 'aria-label': 'Tool or custom skill, with its ability, such as Thieves’ Tools (Dex)' }),
      advDis('Too', 'Tool or custom skill'),
      el('span', { cls: 'v num', 'data-out': 'Too', text: '–' }),
    ]));
  }
  function buildHitDice() {
    const box = $('#hitdice');
    box.textContent = '';
    for (let i = 1; i <= HITDICE; i++) {
      box.append(el('div', { cls: 'hd', 'data-row': 'HD' + i + ' Level' }, [
        el('span', { 'data-hd': String(i), text: 'Hit dice' }),
        el('label', { cls: 'hd-die' }, [el('span', { cls: 'hint', text: 'Die' }), el('input', { cls: 'num', 'data-f': 'HD' + i + ' Die', id: 'f-hdd' + i, inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Hit die size' })]),
        el('span', { cls: 'hint hd-con', 'data-hdcon': String(i) }),
        el('label', { cls: 'uses' }, [el('span', { cls: 'hint', text: 'Used' }), el('input', { cls: 'num', 'data-f': 'HD' + i + ' Used', id: 'f-hd' + i, inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Hit dice used' })]),
      ]));
    }
  }
  // the "⋯" on a line: MPMB's line menu (move up/down, insert, delete, clear…)
  const lineMenu = (field, title) => el('button', { cls: 'btn sm more', type: 'button', 'data-mpmb': field, 'data-title': title, 'aria-label': title + ': options', text: '⋯' });
  function buildAttacks() {
    const box = $('#attacks');
    box.textContent = '';
    box.append(el('datalist', { id: 'dl-weapons', 'data-items': 'Attack.1.Weapon Selection' }));
    for (let i = 1; i <= ATTACKS; i++) {
      const p = 'Attack.' + i + '.';
      box.append(el('div', { cls: 'attack', 'data-attack': String(i) }, [
        el('div', { cls: 'line' }, [
          el('label', { cls: 'f' }, [el('span', { text: 'Weapon or cantrip ' + i }), el('input', { cls: 'in', 'data-f': p + 'Weapon Selection', id: 'f-atk' + i, list: 'dl-weapons', autocomplete: 'off', placeholder: 'Pick or type a weapon or cantrip' })]),
          lineMenu('Attack.Button.' + i, 'Attack ' + i),
        ]),
        el('div', { cls: 'figs', 'data-figs': String(i) }, [
          el('span', {}, [el('span', { cls: 'muted', text: 'To hit ' }), el('b', { 'data-out': p + 'To Hit', text: '–' })]),
          el('span', {}, [el('span', { cls: 'muted', text: 'Damage ' }), el('b', { 'data-out': p + 'Damage', text: '–' }), el('span', { text: ' ' }), el('span', { 'data-out': p + 'Damage Type', text: '' })]),
          el('span', {}, [el('span', { cls: 'muted', text: 'Range ' }), el('b', { 'data-out': p + 'Range', text: '–' })]),
        ]),
        el('div', { cls: 'desc', 'data-out': p + 'Description', text: '' }),
        // what MPMB worked the numbers out with: proficiency and ability (MPMB sets them, the player can change them)
        el('div', { cls: 'atk-set', 'data-figs': String(i) }, [
          el('span', { cls: 'tg' }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': p + 'Proficiency', 'aria-pressed': 'false', 'aria-label': 'Attack ' + i + ' proficiency' }), el('span', { text: 'Proficient' })]),
          el('label', { cls: 'f inline' }, [el('span', { text: 'Ability' }), abilitySelect(p + 'Mod', 'Attack ' + i + ' ability', 'empty')]),
        ]),
        // MPMB's modifier ("blue text") fields for this attack, shown when MPMB shows them
        el('div', { cls: 'row atk-mods', 'data-vis': 'BlueText.' + p + 'To Hit Bonus', hidden: '' }, [
          modInput('BlueText.' + p + 'To Hit Bonus', 'To hit +'),
          modInput('BlueText.' + p + 'Damage Bonus', 'Damage +'),
          modInput('BlueText.' + p + 'Damage Die', 'Damage die'),
          modInput('BlueText.' + p + 'Weight', 'Weight'),
        ]),
      ]));
    }
  }
  const modInput = (field, label) => el('label', { cls: 'f mod' }, [el('span', { text: label }), el('input', { cls: 'in num', 'data-f': field, id: 'f-mod-' + field.replace(/\W+/g, '-'), autocomplete: 'off', inputmode: 'text' })]);
  const MOD_SWITCHES = [['Jack of All Trades', 'Jack of All Trades'], ['Remarkable Athlete', 'Remarkable Athlete'], ['Proficiency Bonus Dice', 'Proficiency dice'], ['BlueText.Players Make All Rolls', 'Players make all rolls']];
  function buildMods() {
    const box = $('#mods');
    box.textContent = '';
    const group = (title, items) => box.append(el('div', { cls: 'mods-group' }, [el('span', { cls: 'lbl', text: title }), el('div', { cls: 'mods-grid' }, items.map(([f, l]) => modInput(f, l)))]));
    // MPMB's optional rules and class features that change its calculations (tick boxes in the modifier area)
    box.append(el('div', { cls: 'mods-group' }, [el('span', { cls: 'lbl', text: 'Options' }), el('div', { cls: 'toggles' }, MOD_SWITCHES.map(([f, l]) =>
      el('span', { cls: 'tg', 'data-vis': f, hidden: '' }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': f, 'aria-pressed': 'false', 'aria-label': l }), el('span', { text: l })])))]));
    group('Weight', [['AC Armor Weight', 'Armor'], ['AC Shield Weight', 'Shield']]);
    group('General', [['Proficiency Bonus Modifier', 'Proficiency'], ['All Skills Bonus', 'All skills'], ['All ST Bonus', 'All saves'], ['Passive Perception Bonus', 'Passive Perc.'], ['Spell DC 1 Bonus', 'Spell DC']]);
    group('Saving throws', ABILITIES.map(([k, long]) => [k + ' ST Bonus', long]));
    group('Skills', SKILLS.map(([f, name]) => [f + ' Bonus', name]));
  }
  function buildLimited() {
    const box = $('#limited');
    box.textContent = '';
    for (let i = 1; i <= LIMITED; i++) {
      box.append(el('li', { 'data-row': 'Limited Feature ' + i }, [
        el('div', {}, [el('div', { 'data-out': 'Limited Feature ' + i }), el('div', { cls: 'hint', 'data-out': 'Limited Feature Recovery ' + i })]),
        el('div', { cls: 'uses' }, [
          el('input', { 'data-f': 'Limited Feature Used ' + i, id: 'f-lf' + i, inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Uses spent', cls: 'num' }),
          el('span', { cls: 'muted', text: '/' }), el('b', { cls: 'num', 'data-out': 'Limited Feature Max Usages ' + i, text: '–' }),
          lineMenu('Button.Limited Feature ' + i, 'Limited feature ' + i),
        ]),
      ]));
    }
    box.append(el('li', { cls: 'empty-note muted', text: 'Nothing yet. Class and species features with limited uses appear here.' }));
  }
  function buildFeats() {
    const box = $('#feats');
    box.textContent = '';
    box.append(el('datalist', { id: 'dl-feats', 'data-items': 'Feat Name 1' }));
    for (let i = 1; i <= FEATS; i++) {
      box.append(el('li', { 'data-feat': String(i) }, [el('div', { cls: 'grow' }, [
        el('div', { cls: 'line' }, [
          el('input', { cls: 'in', 'data-f': 'Feat Name ' + i, id: 'f-feat' + i, list: 'dl-feats', autocomplete: 'off', placeholder: 'Pick or type a feat', 'aria-label': 'Feat ' + i }),
          lineMenu('Feat Button ' + i, 'Feat ' + i),
        ]),
        el('div', { cls: 'hint rich', 'data-rich': 'Feat Description ' + i }),
        el('input', { cls: 'in note', 'data-f': 'Feat Note ' + i, id: 'f-featnote' + i, autocomplete: 'off', placeholder: 'Note (e.g. the choice you made)', 'aria-label': 'Feat ' + i + ' note' }),
      ])]));
    }
  }
  function buildActions() {
    const box = $('#actions');
    box.textContent = '';
    for (const [pre, n, label] of ACTIONS) for (let i = 1; i <= n; i++) box.append(el('li', { 'data-row': pre + ' ' + i }, [el('span', { cls: 'grow', 'data-out': pre + ' ' + i }), el('span', { cls: 'chip', text: label }), lineMenu('Button.' + pre + ' ' + i, label + ' ' + i)]));
    box.append(el('li', { cls: 'empty-note muted', text: 'No actions yet.' }));
  }

  // Spell slots: MPMB has 7 boxes per level and uses these for 1–4 slots (SetSpellSlotsCheckboxes). It hides all of
  // them when the sheet's page-1 slot area is switched off, so the app goes by the count, not by what is visible.
  const SLOT_BOXES = ['top1', 'mid', 'bottom1', 'top2.1', 'top2.2', 'bottom2.1', 'bottom2.2'];
  const SLOT_SETS = [[], ['mid'], ['top1', 'bottom1'], ['top2.1', 'top2.2', 'bottom1'], ['top2.1', 'top2.2', 'bottom2.1', 'bottom2.2']];
  const LEVEL_NAMES = ['Cantrips', '1st level', '2nd level', '3rd level', '4th level', '5th level', '6th level', '7th level', '8th level', '9th level'];
  function buildSlots() {
    const box = $('#slots');
    box.textContent = '';
    for (let l = 1; l <= 9; l++) {
      const pips = SLOT_BOXES.map((b, i) => el('button', { cls: 'dot sm', type: 'button', 'data-toggle': 'SpellSlots.Checkboxes.lvl' + l + '.' + b, 'aria-pressed': 'false', 'aria-label': LEVEL_NAMES[l] + ' slot ' + (i + 1) + ' used' }));
      box.append(el('div', { cls: 'slot-row', 'data-slots': String(l) }, [el('span', { cls: 'lv', text: LEVEL_NAMES[l].replace(' level', '') })].concat(pips)));
    }
    box.append(el('p', { cls: 'note', id: 'slots-none', text: 'No spell slots yet.' }));
  }
  function buildProfs() {
    const tg = (f, label) => el('span', { cls: 'tg' }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': f, 'aria-pressed': 'false', 'aria-label': label + ' proficiency' }), el('span', { text: label })]);
    const a = $('#prof-armor'), w = $('#prof-weapons');
    a.textContent = ''; w.textContent = '';
    a.append(tg('Proficiency Armor Light', 'Light'), tg('Proficiency Armor Medium', 'Medium'), tg('Proficiency Armor Heavy', 'Heavy'), tg('Proficiency Shields', 'Shields'));
    w.append(tg('Proficiency Weapon Simple', 'Simple'), tg('Proficiency Weapon Martial', 'Martial'));
    // tools and languages: MPMB's 8 lines each; the filled ones show, plus one empty line to add to (refreshDerived)
    for (const [id, pre, list, label] of [['#tools', 'Tool ', 'dl-tools', 'Tool'], ['#languages', 'Language ', 'dl-languages', 'Language']]) {
      const box = $(id);
      box.textContent = '';
      box.append(el('datalist', { id: list }));
      for (let i = 1; i <= 8; i++) box.append(el('input', { cls: 'in', 'data-f': pre + i, id: 'f-' + list.slice(3) + i, list, autocomplete: 'off', 'aria-label': label + ' ' + i, placeholder: 'Add ' + label.toLowerCase() }));
    }
    const dl = $('#dl-languages');
    for (const n of LANGUAGES) dl.append(el('option', { value: n }));
  }
  // Defense details: advantage marks, the AC parts, damage resistances; spell save DC
  function buildDefense() {
    $('#init-ad').replaceChildren(advDis('Init', 'Initiative'));
    $('#att-ad').replaceChildren(advDis('Att', 'Attack rolls'));
    const res = $('#resistances');
    res.textContent = '';
    res.append(el('datalist', { id: 'dl-res', 'data-items': 'Resistance Damage Type 1' }));
    for (let i = 1; i <= 6; i++) res.append(el('input', { cls: 'in', 'data-f': 'Resistance Damage Type ' + i, id: 'f-res' + i, list: 'dl-res', autocomplete: 'off', 'aria-label': 'Resistance ' + i, placeholder: 'Add resistance' }));
    $('#dc1-mod').replaceChildren(abilitySelect('Spell DC 1 Mod', 'Ability of save DC 1', ' '));
    $('#dc2-mod').replaceChildren(abilitySelect('Spell DC 2 Mod', 'Ability of save DC 2', ' '));
  }
  function buildCoins() {
    const box = $('#coins');
    box.textContent = '';
    for (const [f, k, long] of [['Copper Pieces', 'cp', 'Copper'], ['Silver Pieces', 'sp', 'Silver'], ['Electrum Pieces', 'ep', 'Electrum'], ['Gold Pieces', 'gp', 'Gold'], ['Platinum Pieces', 'pp', 'Platinum']]) {
      box.append(el('label', {}, [el('span', { text: k }), el('input', { cls: 'in num', 'data-f': f, id: 'f-coin-' + k, inputmode: 'numeric', autocomplete: 'off', 'aria-label': long + ' pieces' })]));
    }
  }

  const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Surprised', 'Unconscious'];
  function buildConditions() {
    const box = $('#conditions');
    box.textContent = '';
    for (const c of CONDITIONS) box.append(el('span', { cls: 'tg' }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': 'Condition.' + c, 'aria-pressed': 'false', 'aria-label': c }), el('span', { text: c })]));
  }
  // MPMB's two ammunition trackers on page 1
  function buildAmmo() {
    const box = $('#ammo');
    box.textContent = '';
    for (const [side, pre, label] of [['left', 'AmmoLeft', 'First'], ['right', 'AmmoRight', 'Second']]) {
      const d = pre + 'Display.';
      const shoot = el('button', { cls: 'btn', type: 'button', text: 'Use one', 'data-shoot': side });
      box.append(el('div', { cls: 'ammo' }, [
        el('input', { cls: 'in', 'data-f': d + 'Name', id: 'f-ammo-' + side, list: 'dl-ammo-' + side, autocomplete: 'off', placeholder: label + ' ammunition (arrows, bolts…)', 'aria-label': label + ' ammunition' }),
        el('datalist', { id: 'dl-ammo-' + side, 'data-items': d + 'Name' }),
        el('div', { cls: 'figs' }, [
          el('input', { cls: 'in num', 'data-f': d + 'Amount', id: 'f-ammon-' + side, inputmode: 'numeric', autocomplete: 'off', 'aria-label': label + ' ammunition: how many', style: 'width:5rem' }),
          shoot,
          el('span', { cls: 'hint' }, [document.createTextNode('Weight '), el('b', { 'data-out': d + 'Weight' }), document.createTextNode(' each')]),
        ]),
      ]));
    }
  }

  // Magic items: the 6 lines on the Additional sheet (page 3); Equipment: the 46 lines on page 2
  const MAGIC = 6, GEAR = 46, XGEAR = 42;
  function buildMagicItems() {
    const box = $('#magic-items');
    box.textContent = '';
    for (let i = 1; i <= MAGIC; i++) {
      const p = 'Extra.Magic Item ';
      box.append(el('div', { cls: 'mi', 'data-mi': String(i) }, [
        el('div', { cls: 'line' }, [
          el('input', { cls: 'in', 'data-f': p + i, id: 'f-mi' + i, list: 'dl-magic', autocomplete: 'off', placeholder: 'Pick or type a magic item', 'aria-label': 'Magic item ' + i }),
          lineMenu('Extra.Magic Item Button ' + i, 'Magic item ' + i),
        ]),
        el('div', { cls: 'sub' }, [
          el('span', { cls: 'att', 'data-att': String(i) }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': p + 'Attuned ' + i, 'aria-pressed': 'false', 'aria-label': 'Attuned' }), el('span', { text: 'Attuned' })]),
          el('span', {}, [el('span', { cls: 'muted', text: 'Weight ' }), el('b', { cls: 'num', 'data-out': p + 'Weight ' + i })]),
        ]),
        el('div', { cls: 'rich hint', 'data-rich': p + 'Description ' + i }),
        el('input', { cls: 'in', 'data-f': p + 'Note ' + i, id: 'f-min' + i, autocomplete: 'off', placeholder: 'Notes (charges, who has it…)', 'aria-label': 'Magic item ' + i + ' notes' }),
      ]));
    }
  }
  // gear lists: page 2's equipment ("Adventuring Gear …") and page 3's extra equipment ("Extra.Gear …"), with MPMB's
  // location column (where it's carried) when its Equipment menu shows it, and the weight per location
  function buildGear() {
    const list = (boxSel, p, btn, count, key, idp) => {
      const box = $(boxSel);
      box.textContent = '';
      box.append(el('div', { cls: 'gear-head' }, [el('span', { text: 'Item' }), el('span', { cls: 'gloc', text: 'Where' }), el('span', { text: 'Amount' }), el('span', { text: 'Weight' }), el('span')]));
      for (let i = 1; i <= count; i++) {
        box.append(el('div', { cls: 'gear-row', ['data-' + key]: String(i) }, [
          el('input', { cls: 'in', 'data-f': p + 'Row ' + i, id: 'f-' + idp + i, autocomplete: 'off', placeholder: 'Add an item', 'aria-label': 'Item ' + i }),
          el('input', { cls: 'in gloc', 'data-f': p + 'Location.Row ' + i, id: 'f-' + idp + 'l' + i, autocomplete: 'off', 'aria-label': 'Item ' + i + ': where it is carried', placeholder: 'Where' }),
          el('input', { cls: 'in num', 'data-f': p + 'Amount ' + i, id: 'f-' + idp + 'n' + i, inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Amount' }),
          el('input', { cls: 'in num', 'data-f': p + 'Weight ' + i, id: 'f-' + idp + 'w' + i, inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Weight' }),
          lineMenu(btn + i, 'Item ' + i),
        ]));
      }
    };
    list('#gear-list', 'Adventuring Gear ', 'Adventuring Gear Button ', GEAR, 'gear', 'gear');
    list('#xgear-list', 'Extra.Gear ', 'Extra.Gear Button ', XGEAR, 'xgear', 'xgear');
    for (const [boxSel, p, idp] of [['#gear-loc', 'Adventuring Gear ', 'gear'], ['#xgear-loc', 'Extra.Gear ', 'xgear']]) {
      const box = $(boxSel);
      box.textContent = '';
      for (let n = 1; n <= 6; n++) box.append(el('div', { cls: 'loc-row' }, [
        el('input', { cls: 'in', 'data-f': p + 'Location.SubtotalName ' + n, id: 'f-' + idp + 'ln' + n, autocomplete: 'off', placeholder: 'Location', 'aria-label': 'Location ' + n }),
        el('b', { cls: 'num', 'data-out': p + 'Location.Subtotal ' + n }),
      ]));
    }
  }

  // ---------------------------------------------------------------- companion pages
  // One set of cards per companion page in the PDF. A page's fields carry its prefix ("P4.AScomp."), from the worker's
  // pageList. The first page is in the PDF as distributed; MPMB's Companion Options menu adds and removes pages.
  const COMP_ATTACKS = 3, COMP_GEAR = 24;
  let compPrefixes = [];
  const fid = (name) => 'f-' + name.replace(/\W+/g, '-');
  const cInput = (field, label, attrs) => el('label', { cls: 'f' }, [el('span', { text: label }), el('input', Object.assign({ cls: 'in', 'data-f': field, id: fid(field), autocomplete: 'off' }, attrs || {}))]);
  // a drop-down whose options are the combo box's own items (value: export value, text: what the sheet shows)
  const cSelect = (field, label) => el('select', { cls: 'in', 'data-f': field, 'data-opts': field, id: fid(field), 'aria-label': label });
  const cText = (field, label, rows) => el('label', { cls: 'f', 'data-vis': field, hidden: '' }, [el('span', { text: label }), el('textarea', { cls: 'in', rows: String(rows || 4), 'data-f': field, id: fid(field) })]);
  function buildCompanion(P, n, total) {
    const U = P + 'Comp.Use.';
    const grid = el('div', { cls: 'grid' });
    const card = (title, kids, attrs) => el('div', Object.assign({ cls: 'card' }, attrs || {}), [typeof title === 'string' ? el('h3', { text: title }) : title].concat(kids));
    const opts = el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Companion.Options', 'data-title': 'Companion options', 'data-pages': '1' }, [document.createTextNode('Options')]);
    // the creature: MPMB fills in the whole page from its list
    grid.append(card(el('h3', {}, [el('span', { 'data-compname': P, text: 'Companion' }), opts]), [
      cInput(P + 'Comp.Desc.Name', 'Name'),
      el('label', { cls: 'f' }, [el('span', { text: 'Creature' }), el('input', { cls: 'in', 'data-f': P + 'Comp.Race', id: fid(P + 'Comp.Race'), list: 'dl-' + fid(P + 'race'), autocomplete: 'off', placeholder: 'Pick or type a creature' }), el('datalist', { id: 'dl-' + fid(P + 'race'), 'data-items': P + 'Comp.Race' })]),
      el('p', { cls: 'hint', text: 'MPMB fills in the page from the creature you pick. Options has familiars (Find Familiar, Pact of the Chain), the sections shown, and adding or removing companion pages.' }),
      el('div', { cls: 'row' }, [
        el('label', { cls: 'f' }, [el('span', { text: 'Kind' }), cSelect(P + 'Comp.Type', 'Kind of companion')]),
        el('label', { cls: 'f' }, [el('span', { text: 'Size' }), cSelect(P + 'Comp.Desc.Size', 'Size')]),
      ]),
      el('div', { cls: 'row' }, [
        el('label', { cls: 'f' }, [el('span', { text: 'Type' }), cSelect(P + 'Comp.Desc.MonsterType', 'Creature type')]),
        el('label', { cls: 'f' }, [el('span', { text: 'Alignment' }), cSelect(P + 'Comp.Desc.Alignment', 'Alignment')]),
      ]),
      el('details', { cls: 'more' }, [el('summary', { text: 'Description' }), el('div', { cls: 'row' }, [
        cInput(P + 'Comp.Desc.Sex', 'Sex'), cInput(P + 'Comp.Desc.Age', 'Age'), cInput(P + 'Comp.Desc.Height', 'Height'), cInput(P + 'Comp.Desc.Weight', 'Weight'),
      ])]),
      el('div', { cls: 'pics' }, [picture(P + 'Comp.img.Portrait', 'Companion picture', 245, 151, 'one')]),
    ]));
    // abilities, saves, defense
    const abis = el('div', { cls: 'abilities' });
    for (const [k, long] of ABILITIES) {
      const A = U + 'Ability.' + k + '.';
      abis.append(el('div', { cls: 'abi' }, [
        el('span', { cls: 'k', text: k.toUpperCase(), title: long }),
        el('span', { cls: 'mod num', 'data-out': A + 'Mod', text: '–' }),
        el('input', { 'data-f': A + 'Score', id: fid(A + 'Score'), inputmode: 'numeric', autocomplete: 'off', 'aria-label': long + ' score', cls: 'num' }),
        el('div', { cls: 'save' }, [
          el('button', { cls: 'dot sm', type: 'button', 'data-toggle': A + 'ST.Prof', 'aria-pressed': 'false', 'aria-label': long + ' saving throw proficiency' }),
          el('span', { text: 'Save ' }), el('b', { cls: 'num', 'data-out': A + 'ST.Mod', text: '–' }),
        ]),
      ]));
    }
    grid.append(card('Stats', [
      el('div', { cls: 'stats' }, [
        el('div', { cls: 'stat big' }, [el('span', { cls: 'k', text: 'Armor Class' }), el('span', { cls: 'v num', 'data-out': U + 'AC', text: '–' })]),
        el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Initiative' }), el('span', { cls: 'v num', 'data-out': U + 'Combat.Init.Mod', text: '–' })]),
        el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Proficiency' }), el('span', { cls: 'v num', 'data-out': U + 'Proficiency Bonus', text: '–' })]),
        el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Passive Perc.' }), el('span', { cls: 'v num', 'data-out': U + 'Skills.Perc.Pass.Mod', text: '–' })]),
      ]),
      el('div', { cls: 'row-ad' }, [el('span', { cls: 'muted', text: 'Initiative rolls' }), el('span', { cls: 'ad' }, [
        el('button', { type: 'button', 'data-toggle': U + 'Initiative.Adv', 'aria-pressed': 'false', 'aria-label': 'Initiative: advantage', title: 'Advantage', text: 'A' }),
        el('button', { type: 'button', 'data-toggle': U + 'Initiative.Dis', 'aria-pressed': 'false', 'aria-label': 'Initiative: disadvantage', title: 'Disadvantage', text: 'D' }),
      ])]),
      el('div', { cls: 'row' }, [cInput(U + 'AC', 'Armor Class'), cInput(U + 'Speed', 'Speed'), cInput(U + 'Combat.Init.Bonus', 'Initiative bonus', { cls: 'in num', inputmode: 'text' })]),
      cInput(U + 'Senses', 'Senses'),
      abis,
    ]));
    // hit points: current, max (MPMB's Set menu), temporary, hit dice, death saves; Long rest is MPMB's heal button
    const dots = (kind, label) => el('div', { cls: 'grp' }, [el('span', { cls: 'lbl', text: label })].concat([1, 2, 3].map((i) =>
      el('button', { cls: 'dot sm', type: 'button', 'data-toggle': U + 'DeathSave.' + kind + '.' + i, 'aria-pressed': 'false', 'aria-label': 'Death save ' + label.toLowerCase().replace(/s$/, '') + ' ' + i }))));
    grid.append(card(el('h3', {}, [el('span', { text: 'Hit points' }), el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Comp.Heal', 'data-title': 'Long rest', 'data-done': 'Long rest: hit points and death saves reset, half the hit dice back.' }, [document.createTextNode('Long rest')])]), [
      el('div', { cls: 'hp' }, [
        el('button', { cls: 'btn', type: 'button', 'data-step': U + 'HP.Current', 'data-by': '-1', 'aria-label': 'Lose 1 hit point', text: '−' }),
        el('input', { cls: 'in num', 'data-f': U + 'HP.Current', id: fid(U + 'HP.Current'), inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Current hit points' }),
        el('button', { cls: 'btn', type: 'button', 'data-step': U + 'HP.Current', 'data-by': '1', 'aria-label': 'Gain 1 hit point', text: '+' }),
      ]),
      el('div', { cls: 'row' }, [
        el('div', { cls: 'f' }, [el('span', { cls: 'flabel' }, [document.createTextNode('Max '), el('button', { cls: 'linkish', type: 'button', 'data-mpmb': P + 'Buttons.Comp.Use.HP.Max', 'data-title': 'Max HP', text: 'Set' })]),
          el('input', { cls: 'in num', 'data-f': U + 'HP.Max', id: fid(U + 'HP.Max'), inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Max hit points' })]),
        cInput(U + 'HP.Temp', 'Temporary', { inputmode: 'numeric', cls: 'in num' }),
      ]),
      el('div', { cls: 'row three' }, [
        cInput(U + 'HD.Level', 'Hit dice', { inputmode: 'numeric', cls: 'in num' }),
        cInput(U + 'HD.Die', 'Die', { inputmode: 'numeric', cls: 'in num' }),
        cInput(U + 'HD.Used', 'Used', { inputmode: 'numeric', cls: 'in num' }),
      ]),
      el('p', { cls: 'hint' }, [document.createTextNode('Constitution adds '), el('b', { cls: 'num', 'data-out': U + 'HD.Con' }), document.createTextNode(' per hit die.')]),
      el('div', { cls: 'deaths' }, [dots('Success', 'Successes'), dots('Fail', 'Failures')]),
    ]));
    // skills: MPMB's skill name button cycles not proficient → proficient → expertise
    const skills = el('div', { cls: 'skills two' });
    for (const [f, name, abi] of SKILLS) {
      skills.append(el('div', { cls: 'skill' }, [
        el('button', { cls: 'dot sm', type: 'button', 'data-mpmb': P + 'Text.Comp.Use.Skills.' + f + '.Name', 'data-prof': P + 'Text.Comp.Use.Skills.' + f + '.Prof', 'data-title': name, 'aria-pressed': 'false', 'aria-label': name + ' proficiency' }),
        el('span', { cls: 'n', text: name }), el('span', { cls: 'a', text: abi }),
        el('span', { cls: 'v num', 'data-out': U + 'Skills.' + f + '.Mod', text: '–' }),
      ]));
    }
    grid.append(card('Skills', [el('p', { cls: 'hint', text: 'Tap a dot for proficiency, again for expertise, a third time to clear.' }), skills], { 'data-span': '2' }));
    // attacks
    const atks = el('div', {}, [el('datalist', { id: 'dl-' + fid(P + 'atk'), 'data-items': U + 'Attack.1.Weapon Selection' })]);
    for (let i = 1; i <= COMP_ATTACKS; i++) {
      const p = U + 'Attack.' + i + '.';
      atks.append(el('div', { cls: 'attack', 'data-cattack': p }, [
        el('div', { cls: 'line' }, [
          el('label', { cls: 'f' }, [el('span', { text: 'Attack ' + i }), el('input', { cls: 'in', 'data-f': p + 'Weapon Selection', id: fid(p + 'Weapon Selection'), list: 'dl-' + fid(P + 'atk'), autocomplete: 'off', placeholder: 'Pick or type an attack' })]),
          lineMenu(U + 'Attack.Button.' + i, 'Attack ' + i),
        ]),
        el('div', { cls: 'figs', 'data-figs': '1' }, [
          el('span', {}, [el('span', { cls: 'muted', text: 'To hit ' }), el('b', { 'data-out': p + 'To Hit', text: '–' })]),
          el('span', {}, [el('span', { cls: 'muted', text: 'Damage ' }), el('b', { 'data-out': p + 'Damage', text: '–' }), el('span', { text: ' ' }), el('span', { 'data-out': p + 'Damage Type', text: '' })]),
          el('span', {}, [el('span', { cls: 'muted', text: 'Range ' }), el('b', { 'data-out': p + 'Range', text: '–' })]),
        ]),
        el('div', { cls: 'desc', 'data-out': p + 'Description', 'data-figs': '1', text: '' }),
        el('div', { cls: 'atk-set', 'data-figs': '1' }, [
          el('span', { cls: 'tg' }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': p + 'Proficiency', 'aria-pressed': 'false', 'aria-label': 'Attack ' + i + ' proficiency' }), el('span', { text: 'Proficient' })]),
          el('label', { cls: 'f inline' }, [el('span', { text: 'Ability' }), cSelect(p + 'Mod', 'Attack ' + i + ' ability')]),
        ]),
        el('div', { cls: 'row atk-mods', 'data-vis': P + 'BlueText.Comp.Use.Attack.' + i + '.To Hit Bonus', hidden: '' }, [
          modInput(P + 'BlueText.Comp.Use.Attack.' + i + '.To Hit Bonus', 'To hit +'),
          modInput(P + 'BlueText.Comp.Use.Attack.' + i + '.Damage Bonus', 'Damage +'),
          modInput(P + 'BlueText.Comp.Use.Attack.' + i + '.Damage Die', 'Damage die'),
        ]),
      ]));
    }
    grid.append(card('Attacks', [el('div', { cls: 'row-ad' }, [el('label', { cls: 'f inline' }, [el('span', { text: 'Attacks per action' }), el('input', { cls: 'in num', 'data-f': U + 'Attack.perAction', id: fid(U + 'Attack.perAction'), inputmode: 'numeric', autocomplete: 'off' })])]), atks], { 'data-span': '2' }));
    // traits and features as MPMB formats them, with the text to edit underneath
    const richBox = (field, label) => el('div', { cls: 'stack' }, [
      el('span', { cls: 'lbl', text: label }), el('div', { cls: 'rich', 'data-rich': field, 'data-empty': 'None' }),
      el('details', { cls: 'more' }, [el('summary', { text: 'Edit ' + label.toLowerCase() }), el('textarea', { cls: 'in', rows: '6', 'data-f': field, id: fid(field), 'aria-label': label })]),
    ]);
    grid.append(card('Traits and features', [richBox(U + 'Traits', 'Traits'), richBox(U + 'Features', 'Features')]));
    // MPMB's modifier ("blue text") fields for the companion, shown when MPMB shows them (Functions → Modifiers)
    const B = P + 'BlueText.Comp.Use.';
    const mgroup = (title, items) => el('div', { cls: 'mods-group' }, [el('span', { cls: 'lbl', text: title }), el('div', { cls: 'mods-grid' }, items.map(([f, l]) => modInput(f, l)))]);
    grid.append(card('Modifiers', [
      el('p', { cls: 'hint', text: 'MPMB adds these to its own calculations for the companion. Type a number, or an ability such as Wis.' }),
      el('span', { cls: 'tg' }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': B + 'Proficiency Bonus Dice', 'aria-pressed': 'false', 'aria-label': 'Proficiency dice' }), el('span', { text: 'Proficiency dice' })]),
      mgroup('General', [[B + 'Skills.All.Bonus', 'All skills'], [B + 'Ability.All.ST.Bonus', 'All saves'], [B + 'Skills.Perc.Pass.Bonus', 'Passive Perc.']]),
      mgroup('Saving throws', ABILITIES.map(([k, long]) => [B + 'Ability.' + k + '.ST.Bonus', long])),
      mgroup('Skills', SKILLS.map(([f, name]) => [B + 'Skills.' + f + '.Bonus', name])),
    ], { 'data-span': '2', 'data-vis': B + 'Skills.Acr.Bonus', hidden: '' }));
    // equipment (MPMB can hide this section: Options → Change visible sections)
    const gear = el('div', {}, [el('div', { cls: 'gear-head' }, [el('span', { text: 'Item' }), el('span', { text: 'Amount' }), el('span', { text: 'Weight' }), el('span')])]);
    for (let i = 1; i <= COMP_GEAR; i++) {
      const g = P + 'Comp.eqp.Gear ';
      gear.append(el('div', { cls: 'gear-row', 'data-cgear': g + 'Row ' + i }, [
        el('input', { cls: 'in', 'data-f': g + 'Row ' + i, id: fid(g + 'Row ' + i), autocomplete: 'off', placeholder: 'Add an item', 'aria-label': 'Item ' + i }),
        el('input', { cls: 'in num', 'data-f': g + 'Amount ' + i, id: fid(g + 'Amount ' + i), inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Amount' }),
        el('input', { cls: 'in num', 'data-f': g + 'Weight ' + i, id: fid(g + 'Weight ' + i), inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Weight' }),
        lineMenu(P + 'Comp.eqpB.Button ' + i, 'Item ' + i),
      ]));
    }
    grid.append(card('Equipment', [gear], { 'data-span': '2', 'data-vis': P + 'Comp.eqp.Gear Row 1', hidden: '' }));
    // notes: the page's notes columns and the boxes MPMB shows in place of a hidden section
    grid.append(card(el('h3', {}, [el('span', { text: 'Notes' }), el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Cnote.Options', 'data-title': 'Notes options' }, [document.createTextNode('Options')])]), [
      cText(P + 'Cnote.Left', 'Notes', 8), cText(P + 'Cnote.Right', 'More notes', 8),
      cText(P + 'Comp.img.Notes', 'Appearance', 4), cText(P + 'Comp.eqp.Notes', 'Notes (in place of equipment)', 6),
    ]));
    for (const c of grid.children) if (c.dataset.span) c.classList.add('span-2');
    // with more than one companion, a heading per companion
    const head = total > 1 ? [el('h3', { cls: 'comp-title' }, [el('span', { 'data-compname': P, text: 'Companion' }), el('span', { cls: 'chip', text: n + ' of ' + total })])] : [];
    return el('div', { cls: 'comp', 'data-comp': P }, head.concat([grid]));
  }
  // build (or rebuild) the companion cards when the companion pages change, and watch their fields
  async function syncCompanions(list) {
    const p = (list || []).filter((x) => x.key === 'AScomp')[0];
    const prefixes = p ? p.prefixes : [];
    if (JSON.stringify(prefixes) === JSON.stringify(compPrefixes) && $('#comp-list').childElementCount === prefixes.length) return;
    compPrefixes = prefixes.slice();
    const box = $('#comp-list');
    box.textContent = '';
    prefixes.forEach((P, i) => box.append(buildCompanion(P, i + 1, prefixes.length)));
    $('#comp-none').hidden = prefixes.length > 0;
    $('#comp-add').hidden = prefixes.length > 0;
    buildIndex();
    const names = new Set();
    for (const n of $$(BOUND.map((a) => '#comp-list [' + a + ']').join(','))) for (const a of BOUND) if (n.hasAttribute(a)) names.add(n.getAttribute(a));
    for (const P of prefixes) names.add(P + 'Comp.Use.Ability.Str.Mod');
    if (names.size) { const snaps = await state.worker.call('watch', { names: Array.from(names) }); for (const s of snaps) apply(s); }
    layoutGrids(true, $$('#comp-list .grid'));
    refreshDerived();
  }
  function refreshCompanions(v) {
    for (const h of $$('[data-compname]')) {
      const P = h.dataset.compname;
      h.textContent = v(P + 'Comp.Desc.Name') || v(P + 'Comp.Race') || 'Companion';
    }
    // attacks and equipment: the filled lines plus the first empty one
    for (const comp of $$('[data-comp]')) {
      let first = true;
      for (const row of comp.querySelectorAll('[data-cattack]')) {
        const has = v(row.dataset.cattack + 'Weapon Selection') !== '' || row.contains(document.activeElement);
        row.hidden = !has && !first;
        for (const x of row.querySelectorAll('[data-figs]')) x.hidden = !has;
        row.querySelector('.more').hidden = !has;
        if (!has) first = false;
      }
      first = true;
      for (const row of comp.querySelectorAll('[data-cgear]')) {
        const has = v(row.dataset.cgear) !== '' || row.contains(document.activeElement);
        row.hidden = !has && !first;
        row.querySelector('.more').hidden = !has;
        if (!has) first = false;
      }
    }
  }

  // ---------------------------------------------------------------- wild shape pages
  // MPMB's Wild Shapes page (template WSfront): four shapes per page, each worked out by MPMB from the creature picked
  // in its Wildshape.Race.N box, plus the page's Wild Shape details (copies of MPMB's Wildshapes.Info fields). The
  // page's Settings menu adds and removes shapes (limited to what the character can take), recalculates and adds
  // or removes pages. The PDF as distributed has none; the band shows once there is a page or MPMB has given the
  // character Wild Shape.
  const WS_PER_PAGE = 4, WS_ATTACKS = 2, WS_BLANK = 'make a selection';
  let wsPrefixes = [];
  function buildWildShapePage(P, n, total) {
    const grid = el('div', { cls: 'grid' });
    const card = (title, kids, attrs) => el('div', Object.assign({ cls: 'card' }, attrs || {}), [typeof title === 'string' ? el('h3', { text: title }) : title].concat(kids));
    const I = P + 'Wildshapes.Info.';
    grid.append(card(el('h3', {}, [el('span', { text: 'Wild Shape' }), el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Wildshapes.Settings', 'data-title': 'Wild Shapes', 'data-pages': '1' }, [document.createTextNode('Options')])]), [
      el('p', { cls: 'hint', text: 'Options → Add Wild Shape lists the beasts this character can take; MPMB works out each shape with your own proficiencies. It also removes shapes, recalculates them (after a level up) and adds or removes Wild Shapes pages.' }),
      el('div', { cls: 'row' }, [cInput(I + 'KnownForms', 'Known forms'), cInput(I + 'TempHP', 'Temp HP', { inputmode: 'numeric', cls: 'in num' })]),
      cInput(I + 'Limitations', 'Limitations'),
      cInput(I + 'Duration', 'Duration'),
    ]));
    for (let i = 1; i <= WS_PER_PAGE; i++) {
      const W = P + 'Wildshape.' + i + '.', T = P + 'Text.Wildshape.' + i + '.Skills.', race = P + 'Wildshape.Race.' + i;
      const body = el('div', { cls: 'stack', 'data-wsbody': '1' });
      body.append(
        el('div', { cls: 'row' }, [
          el('label', { cls: 'f' }, [el('span', { text: 'Type' }), cSelect(W + 'MonsterType', 'Creature type')]),
          el('label', { cls: 'f' }, [el('span', { text: 'Size' }), cSelect(W + 'Size', 'Size')]),
        ]),
        el('div', { cls: 'row' }, [cInput(W + 'CR', 'Challenge'), cInput(W + 'HD', 'Hit dice')]),
        el('div', { cls: 'stats' }, [
          el('div', { cls: 'stat big' }, [el('span', { cls: 'k', text: 'Armor Class' }), el('span', { cls: 'v num', 'data-out': W + 'AC', text: '–' })]),
          el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Initiative' }), el('span', { cls: 'v num', 'data-out': W + 'Initiative Bonus', text: '–' })]),
          el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Proficiency' }), el('span', { cls: 'v num', 'data-out': W + 'Proficiency Bonus', text: '–' })]),
          el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Passive Perc.' }), el('span', { cls: 'v num', 'data-out': W + 'Skills.PassPerc', text: '–' })]),
        ]),
        cInput(W + 'Speed', 'Speed'),
        el('div', { cls: 'row three' }, [
          cInput(W + 'HP Temp', 'Temp HP', { inputmode: 'numeric', cls: 'in num' }),
          cInput(W + 'HP Current', 'Current HP', { inputmode: 'numeric', cls: 'in num' }),
          cInput(W + 'HP Max', 'Max HP', { inputmode: 'numeric', cls: 'in num' }),
        ]),
      );
      const abis = el('div', { cls: 'abilities' });
      for (const [k, long] of ABILITIES) {
        const A = W + 'Ability.' + k + '.';
        abis.append(el('div', { cls: 'abi' }, [
          el('span', { cls: 'k', text: k.toUpperCase(), title: long }),
          el('span', { cls: 'mod num', 'data-out': A + 'Mod', text: '–' }),
          el('input', { 'data-f': A + 'Score', id: fid(A + 'Score'), inputmode: 'numeric', autocomplete: 'off', 'aria-label': long + ' score', cls: 'num' }),
          el('div', { cls: 'save' }, [
            el('button', { cls: 'dot sm', type: 'button', 'data-toggle': A + 'ST.Prof', 'aria-pressed': 'false', 'aria-label': long + ' saving throw proficiency' }),
            el('span', { text: 'Save ' }), el('b', { cls: 'num', 'data-out': A + 'ST.Mod', text: '–' }),
          ]),
        ]));
      }
      body.append(abis);
      // skills: the proficient ones in the summary, all of them (with MPMB's proficiency buttons) folded
      const skills = el('div', { cls: 'skills two' });
      for (const [f, name, abi] of SKILLS) {
        skills.append(el('div', { cls: 'skill' }, [
          el('button', { cls: 'dot sm', type: 'button', 'data-mpmb': T + f + '.Name', 'data-prof': T + f + '.Prof', 'data-title': name, 'aria-pressed': 'false', 'aria-label': name + ' proficiency' }),
          el('span', { cls: 'n', text: name }), el('span', { cls: 'a', text: abi }),
          el('input', { cls: 'v num in-v', 'data-f': W + 'Skills.' + f, id: fid(W + 'Skills.' + f), inputmode: 'numeric', autocomplete: 'off', 'aria-label': name }),
        ]));
      }
      body.append(el('details', { cls: 'more' }, [el('summary', {}, [document.createTextNode('Skills '), el('span', { cls: 'muted', 'data-wsskills': W })]),
        el('p', { cls: 'hint', text: 'MPMB works these out when the shape is added. A dot marks proficiency (tap again for expertise, a third time to clear) but, as on the PDF, doesn’t change the number: type it in.' }), skills]));
      // attacks as MPMB worked them out, editable underneath
      for (let a = 1; a <= WS_ATTACKS; a++) {
        const p = W + 'Attack.' + a + '.';
        body.append(el('div', { cls: 'attack', 'data-wsattack': p }, [
          el('b', { 'data-out': p + 'Weapon' }),
          el('div', { cls: 'figs' }, [
            el('span', {}, [el('span', { cls: 'muted', text: 'To hit ' }), el('b', { 'data-out': p + 'To Hit', text: '–' })]),
            el('span', {}, [el('span', { cls: 'muted', text: 'Damage ' }), el('b', { 'data-out': p + 'Damage', text: '–' }), el('span', { text: ' ' }), el('span', { 'data-out': p + 'Damage Type', text: '' })]),
            el('span', {}, [el('span', { cls: 'muted', text: 'Range ' }), el('b', { 'data-out': p + 'Range', text: '–' })]),
          ]),
          el('div', { cls: 'desc', 'data-out': p + 'Description', text: '' }),
        ]));
      }
      const edits = [];
      for (let a = 1; a <= WS_ATTACKS; a++) {
        const p = W + 'Attack.' + a + '.';
        edits.push(el('div', { cls: 'stack' }, [
          cInput(p + 'Weapon', 'Attack ' + a),
          el('div', { cls: 'row three' }, [cInput(p + 'To Hit', 'To hit'), cInput(p + 'Damage', 'Damage'), cInput(p + 'Range', 'Range')]),
          el('label', { cls: 'f' }, [el('span', { text: 'Damage type' }), el('input', { cls: 'in', 'data-f': p + 'Damage Type', id: fid(p + 'Damage Type'), list: 'dl-' + fid(p + 'Damage Type'), autocomplete: 'off' }), el('datalist', { id: 'dl-' + fid(p + 'Damage Type'), 'data-items': p + 'Damage Type' })]),
          cInput(p + 'Description', 'Description'),
        ]));
      }
      body.append(el('details', { cls: 'more' }, [el('summary', { text: 'Edit attacks' })].concat(edits)));
      // traits as MPMB formats them (senses, special abilities)
      body.append(el('div', { cls: 'stack' }, [
        el('span', { cls: 'lbl', text: 'Traits' }), el('div', { cls: 'rich', 'data-rich': W + 'Traits', 'data-empty': 'None' }),
        el('details', { cls: 'more' }, [el('summary', { text: 'Edit traits' }), el('textarea', { cls: 'in', rows: '6', 'data-f': W + 'Traits', id: fid(W + 'Traits'), 'aria-label': 'Traits' })]),
      ]));
      grid.append(card(el('h3', {}, [el('span', { 'data-wsname': race, text: 'Shape ' + i }), el('span', { cls: 'chip', 'data-wscr': W + 'CR', hidden: '' })]), [
        el('label', { cls: 'f' }, [el('span', { text: 'Creature' }), el('input', { cls: 'in', 'data-f': race, 'data-blank': WS_BLANK, id: fid(race), list: 'dl-' + fid(race), autocomplete: 'off', placeholder: 'Pick or type a beast' }), el('datalist', { id: 'dl-' + fid(race), 'data-items': race })]),
        body,
      ], { 'data-ws': race }));
    }
    const head = total > 1 ? [el('h3', { cls: 'comp-title' }, [el('span', { text: 'Wild Shapes page' }), el('span', { cls: 'chip', text: n + ' of ' + total })])] : [];
    return el('div', { cls: 'comp', 'data-wspage': P }, head.concat([grid]));
  }
  // build (or rebuild) the wild shape cards when the Wild Shapes pages change, and watch their fields
  async function syncWildShapes(list) {
    const p = (list || []).filter((x) => x.key === 'WSfront')[0];
    const prefixes = p ? p.prefixes : [];
    if (JSON.stringify(prefixes) === JSON.stringify(wsPrefixes) && $('#ws-list').childElementCount === prefixes.length) return;
    wsPrefixes = prefixes.slice();
    const box = $('#ws-list');
    box.textContent = '';
    prefixes.forEach((P, i) => box.append(buildWildShapePage(P, i + 1, prefixes.length)));
    buildIndex();
    const names = new Set();
    for (const n of $$(BOUND.map((a) => '#ws-list [' + a + ']').join(','))) for (const a of BOUND) if (n.hasAttribute(a)) names.add(n.getAttribute(a));
    if (names.size) { const snaps = await state.worker.call('watch', { names: Array.from(names) }); for (const s of snaps) apply(s); }
    layoutGrids(true, $$('#ws-list .grid'));
    refreshDerived();
  }
  function refreshWildShapes(v) {
    const band = $('#wildshape');
    // the band: shown with a Wild Shapes page, or when MPMB has given the character Wild Shape (its known forms)
    const has = wsPrefixes.length > 0, known = v('Wildshapes.Info.KnownForms') !== '';
    const show = has || known;
    if (band.hidden === show) { band.hidden = !show; $('#tab-wildshape').hidden = !show; }
    $('#ws-none').hidden = has;
    $('#ws-add').hidden = has;
    // shapes: the picked ones plus the first empty one per page
    const changed = [];
    for (const page of $$('[data-wspage]')) {
      let first = true;
      for (const c of page.querySelectorAll('[data-ws]')) {
        const r = v(c.dataset.ws), picked = r !== '' && r.toLowerCase() !== WS_BLANK;
        const hide = !picked && !first && !c.contains(document.activeElement);
        if (c.hidden !== hide) { c.hidden = hide; if (changed.indexOf(page) === -1) changed.push(page); }
        c.querySelector('[data-wsbody]').hidden = !picked;
        const name = c.querySelector('[data-wsname]');
        name.textContent = picked ? r : 'Add a shape';
        const cr = c.querySelector('[data-wscr]'), crv = v(cr.dataset.wscr);
        cr.textContent = 'CR ' + crv; cr.hidden = !picked || !crv;
        // an attack line without a name stays out of sight
        for (const a of c.querySelectorAll('[data-wsattack]')) a.hidden = v(a.dataset.wsattack + 'Weapon') === '';
        if (!picked) first = false;
      }
    }
    for (const s of $$('[data-wsskills]')) {
      const W = s.dataset.wsskills, T = W.replace(/Wildshape\.(\d+)\.$/, 'Text.Wildshape.$1.Skills.');
      const prof = SKILLS.filter(([f]) => { const x = v(T + f + '.Prof'); return x === 'proficient' || x === 'expertise'; })
        .map(([f, name]) => name + ' ' + v(W + 'Skills.' + f));
      s.textContent = prof.length ? '(' + prof.join(', ') + ')' : '';
    }
    if (changed.length) layoutGrids(true, changed.map((pg) => pg.querySelector('.grid')));
  }

  // ---------------------------------------------------------------- notes pages
  // MPMB's Notes pages (template ASnotes; the PDF as distributed has one): two columns each, and the page's Options
  // button (lines on or off per column, add a page, remove this one)
  let notesPrefixes = null;
  async function syncNotes(list) {
    const p = (list || []).filter((x) => x.key === 'ASnotes')[0];
    const prefixes = p ? p.prefixes : [];
    $('#notes-add').hidden = prefixes.length > 0;
    if (notesPrefixes && JSON.stringify(prefixes) === JSON.stringify(notesPrefixes)) return;
    notesPrefixes = prefixes.slice();
    const box = $('#notes-pages');
    box.textContent = '';
    prefixes.forEach((P, i) => {
      const n = prefixes.length > 1 ? ' ' + (i + 1) : '';
      box.append(el('div', { cls: 'stack', 'data-notespage': P }, [
        el('div', { cls: 'row' }, [el('span', { cls: 'lbl grow', text: 'Notes page' + n }),
          el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Notes.Options', 'data-title': 'Notes page' + n, 'data-pages': '1' }, [document.createTextNode('Options')])]),
        el('label', { cls: 'f' }, [el('span', { text: 'Left column' }), el('textarea', { cls: 'in', rows: '6', 'data-f': P + 'Notes.Left', id: fid(P + 'Notes.Left') })]),
        el('label', { cls: 'f' }, [el('span', { text: 'Right column' }), el('textarea', { cls: 'in', rows: '6', 'data-f': P + 'Notes.Right', id: fid(P + 'Notes.Right') })]),
      ]));
    });
    buildIndex();
    const names = new Set();
    for (const nd of $$(BOUND.map((a) => '#notes-pages [' + a + ']').join(','))) for (const a of BOUND) if (nd.hasAttribute(a)) names.add(nd.getAttribute(a));
    if (names.size) { const snaps = await state.worker.call('watch', { names: Array.from(names) }); for (const s of snaps) apply(s); }
    refreshDerived();
  }

  // ---------------------------------------------------------------- adventure logsheet pages
  // MPMB's Adventurers League logsheet (template ALlog, from Adventurers League → Show Adventure Logsheet(s)): seven
  // entries per page, each with XP, gold, downtime, renown and magic items as start + gain = total (MPMB carries a
  // total into the next entry's start), and the session's details. The page's Options menu adds and removes pages,
  // generates the next entry and sets the date format; an entry's menu moves, inserts, deletes or clears it.
  const LOG_PER_PAGE = 7;
  const LOG_COUNTS = [['xp', 'XP'], ['gold', 'Gold'], ['downtime', 'Downtime'], ['renown', 'Renown'], ['magicItems', 'Magic items']];
  let logPrefixes = [];
  function buildLogPage(P, n, total) {
    const grid = el('div', { cls: 'grid' });
    const card = (title, kids, attrs) => el('div', Object.assign({ cls: 'card' }, attrs || {}), [title].concat(kids));
    grid.append(card(el('h3', {}, [el('span', { text: 'Logsheet' }), el('span', { cls: 'chip', 'data-out': P + 'AdvLog.sheetNumber', text: '' }),
      el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'AdvLog.Options', 'data-title': 'Logsheet options', 'data-pages': '1' }, [document.createTextNode('Options')])]), [
      el('p', { cls: 'hint', text: 'One entry per session. Options → Generate next Logsheet Entry starts the next one from the totals; Options also sets the date format and adds or removes logsheet pages. An entry’s ⋯ button moves, inserts, deletes or clears it.' }),
    ]));
    for (let i = 1; i <= LOG_PER_PAGE; i++) {
      const E = P + 'AdvLog.' + i + '.';
      const counts = el('div', { cls: 'log-counts' }, [el('span', {}), el('span', { cls: 'k', text: 'Start' }), el('span', { cls: 'k', text: '+ / −' }), el('span', { cls: 'k', text: 'Total' })]);
      for (const [k, label] of LOG_COUNTS) {
        counts.append(el('span', { cls: 'lbl', text: label }),
          el('input', { cls: 'in num', 'data-f': E + k + '.start', id: fid(E + k + '.start'), inputmode: 'decimal', autocomplete: 'off', 'aria-label': label + ' at the start' }),
          el('input', { cls: 'in num', 'data-f': E + k + '.gain', id: fid(E + k + '.gain'), autocomplete: 'off', 'aria-label': label + ' gained or lost' }),
          el('b', { cls: 'num', 'data-out': E + k + '.total', text: '–' }));
      }
      grid.append(card(el('h3', {}, [el('span', { 'data-logname': E, text: 'Entry ' + i }),
        el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Button.AdvLog.' + i, 'data-title': 'Logsheet entry', 'aria-label': 'Entry ' + i + ' menu' }, [document.createTextNode('⋯')])]), [
        el('div', { cls: 'row' }, [cInput(E + 'date', 'Date'), cInput(E + 'session', 'Session')]),
        cInput(E + 'adventure', 'Adventure'),
        cInput(E + 'dm', 'DM (name and DCI)'),
        counts,
        el('div', { cls: 'stack' }, [
          el('span', { cls: 'lbl', text: 'Notes' }), el('div', { cls: 'rich', 'data-rich': E + 'notes', 'data-empty': 'None' }),
          el('details', { cls: 'more' }, [el('summary', { text: 'Edit notes' }), el('textarea', { cls: 'in', rows: '5', 'data-f': E + 'notes', id: fid(E + 'notes'), 'aria-label': 'Notes' })]),
        ]),
      ], { 'data-log': E }));
    }
    const head = total > 1 ? [el('h3', { cls: 'comp-title' }, [el('span', { text: 'Logsheet page' }), el('span', { cls: 'chip', text: n + ' of ' + total })])] : [];
    return el('div', { cls: 'comp', 'data-logpage': P }, head.concat([grid]));
  }
  async function syncLogs(list) {
    const p = (list || []).filter((x) => x.key === 'ALlog')[0];
    const prefixes = p ? p.prefixes : [];
    if (JSON.stringify(prefixes) === JSON.stringify(logPrefixes) && $('#log-list').childElementCount === prefixes.length) return;
    logPrefixes = prefixes.slice();
    const box = $('#log-list');
    box.textContent = '';
    prefixes.forEach((P, i) => box.append(buildLogPage(P, i + 1, prefixes.length)));
    buildIndex();
    const names = new Set();
    for (const n of $$(BOUND.map((a) => '#log-list [' + a + ']').join(','))) for (const a of BOUND) if (n.hasAttribute(a)) names.add(n.getAttribute(a));
    if (names.size) { const snaps = await state.worker.call('watch', { names: Array.from(names) }); for (const s of snaps) apply(s); }
    layoutGrids(true, $$('#log-list .grid'));
    refreshDerived();
  }
  function refreshLogs(v) {
    const show = logPrefixes.length > 0;
    const band = $('#advlog');
    if (band.hidden === show) { band.hidden = !show; $('#tab-advlog').hidden = !show; }
    // entries: the used ones plus the first empty one per page
    const changed = [];
    for (const page of $$('[data-logpage]')) {
      let first = true;
      for (const c of page.querySelectorAll('[data-log]')) {
        const E = c.dataset.log;
        const used = ['date', 'adventure', 'session', 'dm', 'notes', 'xp.gain', 'gold.gain', 'downtime.gain', 'renown.gain', 'magicItems.gain'].some((k) => v(E + k) !== '');
        const hide = !used && !first && !c.contains(document.activeElement);
        if (c.hidden !== hide) { c.hidden = hide; if (changed.indexOf(page) === -1) changed.push(page); }
        const name = c.querySelector('[data-logname]');
        const title = [v(E + 'adventure'), v(E + 'date')].filter((x) => x !== '').join(' · ');
        name.textContent = used ? title || 'Entry ' + E.replace(/^.*AdvLog\.(\d+)\.$/, '$1') : 'New entry';
        if (!used) first = false;
      }
    }
    if (changed.length) layoutGrids(true, changed.map((pg) => pg.querySelector('.grid')));
  }

  // ---------------------------------------------------------------- binding fields to the screen
  function boundNames() {
    const s = new Set();
    for (const n of $$(BOUND.map((a) => '[' + a + ']').join(','))) for (const a of BOUND) if (n.hasAttribute(a)) s.add(n.getAttribute(a));
    for (const [f] of SKILLS.concat([['Too']])) { s.add(f + ' Prof'); s.add(f + ' Exp'); }
    for (let i = 1; i <= HITDICE; i++) { s.add('HD' + i + ' Level'); s.add('HD' + i + ' Die'); s.add('HD' + i + ' Con Mod'); }
    s.add('Extra.Gear Weight Subtotal Left'); s.add('Extra.Gear Weight Subtotal Right');
    for (let i = 1; i <= 8; i++) { s.add('Tool ' + i); s.add('Language ' + i); }
    for (let l = 1; l <= 9; l++) s.add('SpellSlots.CheckboxesSet.lvl' + l);
    return Array.from(s);
  }
  // the attributes that bind an element to an MPMB field (data-mpmb: one of MPMB's buttons, shown when MPMB shows it)
  // data-vis: shown only while MPMB shows that field (its modifier fields, for example)
  // data-opts: a drop-down filled with the combo box's items; data-prof: a skill dot for a not/proficient/expertise box
  // data-pick: a drop-down of a combo box's items by position, for items that share an export value (Size Category)
  // data-icon: the picture one of MPMB's buttons shows (portrait, symbol, companion)
  const BOUND = ['data-f', 'data-out', 'data-rich', 'data-toggle', 'data-items', 'data-mpmb', 'data-vis', 'data-opts', 'data-prof', 'data-pick', 'data-icon'];
  const shown = (snap) => { if (!snap || !snap.exists) return ''; const d = snap.display !== undefined ? snap.display : snap.value; return Array.isArray(d) ? d.join(', ') : String(d === null || d === undefined ? '' : d); };
  function renderRich(node, snap) {
    node.textContent = '';
    if (!snap || !snap.exists) return;
    const spans = snap.spans;
    if (!spans || !spans.length) { node.textContent = shown(snap).replace(/\r\n?/g, '\n'); return; }
    for (const s of spans) {
      const t = String(s.text || '').replace(/\r\n?/g, '\n');
      if (!t) continue;
      let n = document.createTextNode(t);
      if (s.fontStyle === 'italic') { const e = document.createElement('em'); e.append(n); n = e; }
      if (s.fontWeight >= 600) { const b = document.createElement('strong'); b.append(n); n = b; }
      if (s.textColor && s.textColor[0] !== 'T' && !(s.textColor[0] === 'G' && s.textColor[1] === 0)) { const c = document.createElement('span'); c.className = 'c'; c.append(n); n = c; }
      if (s.strikethrough) { const d = document.createElement('s'); d.append(n); n = d; }
      node.append(n);
    }
  }
  // MPMB's feature texts (Class Features, Racial Traits) as a list: one entry per feature, its description folded.
  // MPMB's markup: "**Wizard, level 3:**" heads a class; "#◆ Name# (Wizard 1, SRD'24 77) #[usage]#" starts a class
  // feature (its description on the next lines); "##◆ Name##. text" is a species trait with its text on the same line.
  const openFeatures = new Set();   // which ones the user unfolded, kept while the app is open
  function inlineMarkup(text, into) {
    // *italic*, **bold** and ***bold italic***; stray # (MPMB's colour marker) dropped
    const parts = String(text).replace(/#/g, '').split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/);
    for (const p of parts) {
      if (!p) continue;
      if (/^\*\*\*.+\*\*\*$/.test(p)) into.append(el('strong', {}, [el('em', { text: p.slice(3, -3) })]));
      else if (/^\*\*.+\*\*$/.test(p)) into.append(el('strong', { text: p.slice(2, -2) }));
      else if (/^\*.+\*$/.test(p)) into.append(el('em', { text: p.slice(1, -1) }));
      else into.append(document.createTextNode(p));
    }
  }
  // MPMB's feature texts as a list that folds open (parsing in features.js)
  function renderFeatures(node, snap) {
    const raw = snap && snap.exists ? String(snap.value || '') : '';
    node.textContent = '';
    // Text saved before the line-break fix (descriptions piled up, features left empty): offer a rebuild
    if (node.dataset.features === 'class') { const note = $('#cf-stale'); if (note) note.hidden = !MPMBFeatures.staleClassText(raw); }
    if (!raw.trim()) return;
    for (const it of MPMBFeatures.parse(raw)) {
      if (it.group) { node.append(el('div', { cls: 'fgroup', text: it.group })); continue; }
      if (it.para) { const p = el('p', { cls: 'fpara' }); inlineMarkup(it.para, p); node.append(p); continue; }
      const key = node.dataset.features + '|' + it.name;
      const d = el('details', { cls: 'feat' });
      d.open = openFeatures.has(key);
      d.addEventListener('toggle', () => { if (d.open) openFeatures.add(key); else openFeatures.delete(key); });
      const sum = el('summary', {}, [el('span', { cls: 'fname', text: it.name })]);
      if (it.usage) sum.append(el('span', { cls: 'chip use', text: it.usage }));
      if (it.src) sum.append(el('span', { cls: 'fsrc', text: it.src }));
      d.append(sum);
      const body = el('div', { cls: 'fbody' });
      for (const t of it.text) { const p = el('p'); inlineMarkup(t, p); body.append(p); }
      if (!it.text.length) body.append(el('p', { cls: 'muted', text: 'No description on the sheet.' }));
      d.append(body);
      node.append(d);
    }
  }
  // name -> elements bound to it, per binding kind (rebuilt after the screens are built)
  let index = null;
  function buildIndex() {
    index = new Map();
    for (const attr of BOUND) {
      for (const n of $$('[' + attr + ']')) {
        const key = n.getAttribute(attr);
        if (!index.has(key)) index.set(key, {});
        const e = index.get(key);
        (e[attr] = e[attr] || []).push(n);
      }
    }
  }
  function apply(snap) {
    state.snap.set(snap.name, snap);
    if (snap.name === 'Color.Theme' || snap.name === 'Color.DragonHeads') sheetColors();
    const ix = (index && index.get(snap.name)) || {};
    const sel = (attr) => ix[attr] || [];
    for (const n of sel('data-opts')) {
      const items = (snap.items || []).filter((it) => it[1] !== undefined);
      if (JSON.stringify(items) === n.dataset.had) continue;
      n.dataset.had = JSON.stringify(items);
      n.textContent = '';
      for (const it of items) n.append(el('option', { value: String(it[1]), text: String(it[0]).trim() || '–' }));
    }
    // a combo box can hold text that isn't one of its items (Alignment "Unaligned"): show that too
    for (const n of sel('data-opts')) {
      const v = snap.exists && snap.value !== null && snap.value !== undefined ? String(snap.value) : '';
      if (!Array.from(n.options).some((o) => o.value === v)) n.append(el('option', { value: v, text: v || '–' }));
    }
    for (const n of sel('data-icon')) showIcon(n, snap);
    for (const n of sel('data-pick')) {
      const items = snap.items || [];
      if (JSON.stringify(items) !== n.dataset.had) {
        n.dataset.had = JSON.stringify(items);
        n.textContent = '';
        n.append(el('option', { value: '', text: '–' }));
        items.forEach((it, i) => n.append(el('option', { value: String(i), text: String(it[0]).trim() || '–' })));
      }
      if (document.activeElement !== n) n.value = snap.index >= 0 ? String(snap.index) : '';
    }
    for (const n of sel('data-prof')) { const v = String(snap.value || ''); n.setAttribute('aria-pressed', v === 'proficient' || v === 'expertise' ? 'true' : 'false'); n.classList.toggle('exp', v === 'expertise'); }
    // data-blank: a combo box's "nothing picked" item ("Make a Selection") shows as an empty box
    for (const n of sel('data-f')) {
      if (document.activeElement !== n) { const x = snap.exists ? (Array.isArray(snap.value) ? snap.value.join(', ') : snap.value) : ''; n.value = n.dataset.blank && String(x).toLowerCase() === n.dataset.blank ? '' : x; }
      n.readOnly = !!snap.readonly;
    }
    for (const n of sel('data-out')) { const t = shown(snap); n.textContent = t === '' && n.classList.contains('v') ? '–' : t; }
    for (const n of sel('data-rich')) { if (n.dataset.features) renderFeatures(n, snap); else renderRich(n, snap); }
    for (const n of sel('data-toggle')) n.setAttribute('aria-pressed', snap.checked ? 'true' : 'false');
    for (const n of sel('data-mpmb')) n.hidden = !snap.exists || !!snap.hidden;
    for (const n of sel('data-vis')) n.hidden = !snap.exists || !!snap.hidden;
    for (const n of sel('data-items')) {
      n.textContent = '';
      for (const it of snap.items || []) if (it[0]) n.append(el('option', { value: it[0] }));
    }
  }
  function refreshDerived() {
    const v = (n) => shown(state.snap.get(n)).trim();
    const name = v('PC Name');
    $('#hdr-name').textContent = name || 'Unnamed character';
    const bits = [v('Race'), v('Class and Levels')].filter(Boolean);
    const lvl = v('Character Level');
    if (lvl) bits.push('Level ' + lvl);
    $('#hdr-line').textContent = bits.length ? bits.join(' · ') : 'Choose a species and class to begin';
    // the location column in the gear lists, while MPMB shows it
    for (const [boxSel, p] of [['#gear-list', 'Adventuring Gear '], ['#xgear-list', 'Extra.Gear ']]) {
      const s = state.snap.get(p + 'Location.Row 1');
      const on = !!(s && s.exists && !s.hidden);
      for (const r of $$(boxSel + ' .gear-row, ' + boxSel + ' .gear-head')) r.classList.toggle('loc', on);
    }
    // Background extra: only when the background has options (MPMB fills its list) or it holds something
    const bx = state.snap.get('Background Extra');
    $('#bg-extra').hidden = !(bx && bx.exists && ((bx.items || []).some((it) => String(it[0]).trim()) || String(bx.value === null || bx.value === undefined ? '' : bx.value).trim()));
    // skills: proficiency / expertise dots
    for (const b of $$('[data-skill]')) {
      const f = b.dataset.skill;
      const prof = (state.snap.get(f + ' Prof') || {}).checked, exp = (state.snap.get(f + ' Exp') || {}).checked;
      b.setAttribute('aria-pressed', prof || exp ? 'true' : 'false');
      b.classList.toggle('exp', !!exp);
      const nm = b.parentElement.querySelector('.n');
      b.setAttribute('aria-label', (nm.matches('input') ? nm.value || 'Tool' : nm.textContent) + (exp ? ' expertise' : prof ? ' proficiency' : ' not proficient'));
    }
    // rows that only show when MPMB filled them
    // enough experience for a higher level: MPMB's question is answered "not now"; the app offers Level up instead
    const lvlNow = Number(v('Character Level')) || 0;
    const xpNow = Number(String(v('Total Experience')).replace(/,/g, '')) || 0;
    const xpLevel = state.xpTable ? state.xpTable.reduce((a, t) => a + (xpNow >= t ? 1 : 0), 0) : 0;
    $('#xp-levelup').hidden = !(lvlNow > 0 && xpLevel > lvlNow);
    if (xpLevel > lvlNow) $('#xp-levelup-text').textContent = 'Enough XP for level ' + xpLevel + '.';
    // magic items and gear: filled lines plus the first empty one
    const showFilled = (sel, field, extra) => {
      let first = true;
      for (const row of $$(sel)) {
        const i = row.dataset.mi || row.dataset.gear || row.dataset.xgear;
        const has = v(field(i)) !== '' || row.contains(document.activeElement);
        row.hidden = !has && !first;
        row.querySelector('.more').hidden = !has;
        if (extra) extra(row, i, has);
        if (!has) first = false;
      }
    };
    let attuned = 0;
    showFilled('[data-mi]', (i) => 'Extra.Magic Item ' + i, (row, i, has) => {
      const att = state.snap.get('Extra.Magic Item Attuned ' + i);
      row.querySelector('[data-att]').hidden = !has || !att || !att.exists || !!att.hidden;
      if (has && att && att.checked) attuned++;
      for (const n of row.querySelectorAll('.sub, .rich, [data-f$="Note ' + i + '"]')) n.hidden = !has;
    });
    $('#attuned-chip').textContent = attuned + ' attuned';
    showFilled('[data-gear]', (i) => 'Adventuring Gear Row ' + i);
    showFilled('[data-xgear]', (i) => 'Extra.Gear Row ' + i);
    const xw = (Number(v('Extra.Gear Weight Subtotal Left')) || 0) + (Number(v('Extra.Gear Weight Subtotal Right')) || 0);
    $('#xgear-weight').textContent = xw ? String(Math.round(xw * 100) / 100) : '–';
    // feats: filled lines plus the first empty one, to pick a new feat
    let featEmpty = true;
    for (const li of $$('[data-feat]')) {
      const has = v('Feat Name ' + li.dataset.feat) !== '' || li.contains(document.activeElement);
      li.hidden = !has && !featEmpty;
      li.querySelector('.more').hidden = !has;
      li.querySelector('.note').hidden = !(v('Feat Name ' + li.dataset.feat) !== '');
      if (!has) featEmpty = false;
    }
    for (const list of ['#limited', '#actions']) {
      let any = false;
      for (const li of $$(list + ' [data-row]')) { const has = v(li.dataset.row) !== ''; li.hidden = !has; any = any || has; }
      const note = $(list + ' .empty-note'); if (note) note.hidden = any;
    }
    // attacks: filled rows plus the first empty one
    let firstEmpty = true;
    for (const row of $$('[data-attack]')) {
      const has = v('Attack.' + row.dataset.attack + '.Weapon Selection') !== '' || row.contains(document.activeElement);
      row.hidden = !has && !firstEmpty;
      for (const x of row.querySelectorAll('[data-figs]')) x.hidden = !has;
      row.querySelector('.more').hidden = !has;
      if (!has) firstEmpty = false;
    }
    // hit dice
    let shownHd = 0;
    for (const row of $$('#hitdice [data-row]')) {
      const i = row.dataset.row.slice(2, 3);
      const lv = v('HD' + i + ' Level'), die = v('HD' + i + ' Die');
      const has = lv !== '' && lv !== '0';
      row.hidden = !has && !(i === '1');
      if (has) shownHd++;
      row.querySelector('[data-hd]').textContent = has ? 'Hit dice ' + lv + ' × ' + (die.indexOf('d') === 0 ? die : 'd' + die) : 'Hit dice: none yet';
      row.querySelector('.uses').hidden = !has;
      row.querySelector('.hd-die').hidden = !has;
      const con = v('HD' + i + ' Con Mod');
      row.querySelector('[data-hdcon]').textContent = has && con !== '' ? (Number(con) < 0 ? '' : '+') + con + ' each' : '';
    }
    // spell slots: levels with slots, and only the boxes MPMB shows
    let anySlots = false;
    for (const row of $$('[data-slots]')) {
      const l = row.dataset.slots;
      const n = Number(v('SpellSlots.CheckboxesSet.lvl' + l)) || 0;
      row.hidden = n <= 0;
      anySlots = anySlots || n > 0;
      const use = SLOT_SETS[Math.min(4, Math.max(0, Math.floor(n)))];
      const pips = Array.from(row.querySelectorAll('[data-toggle]'));
      pips.sort((a, b) => use.indexOf(a.dataset.toggle.split('.').slice(3).join('.')) - use.indexOf(b.dataset.toggle.split('.').slice(3).join('.')));
      for (const b of pips) { const k = b.dataset.toggle.split('.').slice(3).join('.'); b.hidden = use.indexOf(k) === -1; if (!b.hidden) row.append(b); }
      let extra = row.querySelector('.of'); if (n > 4) { if (!extra) { extra = el('span', { cls: 'hint of' }); row.append(extra); } extra.textContent = 'of ' + n; } else if (extra) extra.remove();
    }
    const none = $('#slots-none'); if (none) none.hidden = anySlots;
    // tools and languages: show the filled lines and the first empty one (and whichever is being typed in)
    for (const id of ['#tools', '#languages', '#resistances']) {
      let shownEmpty = false;
      for (const n of document.querySelectorAll(id + ' input')) {
        const empty = !v(n.dataset.f) && !n.value.trim();
        n.hidden = empty && shownEmpty && document.activeElement !== n;
        if (empty && !n.hidden) shownEmpty = true;
      }
    }
    refreshCompanions(v);
    refreshWildShapes(v);
    refreshLogs(v);
    // the overflow page's proficiencies: when MPMB put something there or the page is shown
    const over = (state.pages || []).filter((p) => p.key === 'ASoverflow')[0];
    $('#more-profs').hidden = v('MoreProficiencies') === '' && !(over && over.shown) && document.activeElement !== $('#f-more-profs');
    renderLog();
  }

  // ---------------------------------------------------------------- autosave: the character stays on this device
  let saveTimer = 0, saving = false, saveAgain = false;
  function saveSoon() { clearTimeout(saveTimer); setSaved('pending'); saveTimer = setTimeout(saveNow, 700); }
  async function saveNow() {
    saveTimer = 0;
    if (!state.worker || !state.charKey) return;
    if (saving) { saveAgain = true; return; }
    // in the middle of a change with a dialog open, the live copy holds a half-made change: save after it
    if (state.changing) { saveTimer = setTimeout(saveNow, 700); return; }
    saving = true;
    try {
      const st = await state.worker.call('exportState', {});
      const name = shown(state.snap.get('PC Name')).trim();
      await idbPut(state.charKey, { state: st, date: Date.now(), name });
      state.savedAt = Date.now();
      setSaved('saved');
    } catch (e) { setSaved('error'); }
    finally { saving = false; if (saveAgain) { saveAgain = false; saveSoon(); } }
  }
  function setSaved(how) {
    const chip = $('#save-chip');
    chip.classList.toggle('warn', how === 'error');
    chip.textContent = how === 'pending' ? 'Saving…' : how === 'error' ? 'Not saved' : 'Saved';
    chip.title = how === 'error' ? 'This browser didn’t let the app save the character' : state.savedAt ? 'Saved on this device at ' + new Date(state.savedAt).toLocaleTimeString() : 'Saved on this device';
    const info = $('#char-saved');
    if (info) info.textContent = how === 'error' ? 'The character couldn’t be saved in this browser.' : state.savedAt ? 'Saved on this device, last at ' + new Date(state.savedAt).toLocaleString() + '.' : 'Changes are saved on this device as you make them.';
  }

  // ---------------------------------------------------------------- classes: MPMB's Class Selection dialog
  const cls = { opts: null, rows: [] };
  // levelTo: open with the levels needed to reach this total added to the first class (Level up)
  async function openClasses(levelTo) {
    if (!state.worker) return;
    let o;
    try { o = await state.worker.call('classOptions', {}); } catch (e) { return; }
    if (!o.available) { if (o.alerts && o.alerts.length) showNotice(o.alerts); return; }
    cls.opts = o;
    cls.rows = o.rows.length ? o.rows.map((r) => ({ cls: r.cls, sub: r.sub, level: r.level || 1 })) : [{ cls: '', sub: '', level: Math.max(1, o.level || 1) }];
    const total = cls.rows.reduce((a, r) => a + (r.cls ? r.level : 0), 0);
    if (typeof levelTo === 'number' && levelTo > total && cls.rows[0].cls) cls.rows[0].level = Math.min(20, cls.rows[0].level + levelTo - total);
    renderClasses();
    $('#class-panel').showModal();
  }
  function renderClasses() {
    const box = $('#cp-rows');
    box.textContent = '';
    const byName = {};
    for (const c of cls.opts.classes) byName[c.name] = c;
    cls.rows.forEach((r, i) => {
      const used = cls.rows.filter((x, j) => j !== i).map((x) => x.cls);
      const cSel = el('select', { cls: 'in', 'aria-label': 'Class ' + (i + 1) }, [el('option', { value: '', text: i === 0 ? 'Choose a class' : 'Choose a class to add' })]);
      for (const c of cls.opts.classes) if (used.indexOf(c.name) === -1) { const op = el('option', { value: c.name, text: c.name }); if (c.name === r.cls) op.selected = true; cSel.append(op); }
      cSel.addEventListener('change', () => { r.cls = cSel.value; r.sub = ''; renderClasses(); });
      const c = byName[r.cls];
      const sSel = el('select', { cls: 'in', 'aria-label': 'Subclass ' + (i + 1) }, [el('option', { value: '', text: c ? 'No subclass' : 'Subclass' })]);
      if (c) for (const s of c.subclasses) { const op = el('option', { value: s, text: s }); if (s === r.sub) op.selected = true; sSel.append(op); }
      sSel.disabled = !c || !c.subclasses.length;
      sSel.addEventListener('change', () => { r.sub = sSel.value; });
      const lv = el('input', { cls: 'in num', inputmode: 'numeric', value: String(r.level), 'aria-label': 'Level in class ' + (i + 1) });
      const setLv = (n) => { r.level = Math.max(1, Math.min(20, n)); renderClasses(); };
      lv.addEventListener('change', () => setLv(Number(lv.value) || 1));
      const minus = el('button', { cls: 'btn', type: 'button', text: '−', 'aria-label': 'One level less' });
      const plus = el('button', { cls: 'btn', type: 'button', text: '+', 'aria-label': 'One level more' });
      minus.addEventListener('click', () => setLv(r.level - 1));
      plus.addEventListener('click', () => setLv(r.level + 1));
      const kids = [cSel, el('span', { cls: 'stepper' }, [minus, lv, plus]), sSel];
      if (i > 0) { const rm = el('button', { cls: 'btn sm', type: 'button', text: 'Remove' }); rm.addEventListener('click', () => { cls.rows.splice(i, 1); renderClasses(); }); kids.push(rm); }
      else kids.push(el('span'));
      if (c && !r.sub && c.subclasses.length && r.level >= c.subclassLevel) kids.push(el('p', { cls: 'hint sub-note', text: 'A ' + c.name + ' chooses a subclass at level ' + c.subclassLevel + '.' }));
      box.append(el('div', { cls: 'cp-row' }, kids));
    });
    const total = cls.rows.reduce((a, r) => a + (r.cls ? r.level : 0), 0);
    $('#cp-total').textContent = 'Character level ' + total + (cls.opts.level && total !== cls.opts.level ? ' (now ' + cls.opts.level + ')' : '') + '.';
    $('#cp-add').disabled = cls.rows.length >= 10 || cls.rows.some((r) => !r.cls);
  }
  async function applyClasses() {
    const rows = cls.rows.filter((r) => r.cls);
    $('#class-panel').close();
    const res = await send('applyClasses', { rows });
    if (!res) return;
    if (res.errors.length) await showNotice(res.alerts.concat(res.errors.map((m) => ({ title: 'Script error', msg: m }))), 'MPMB reported a problem');
    else toast(rows.length ? 'Class set: ' + rows.map((r) => r.cls + (r.sub ? ' (' + r.sub + ')' : '') + ' ' + r.level).join(', ') : 'Classes removed.');
  }

  // ---------------------------------------------------------------- ability scores: MPMB's Ability Scores dialog
  const ab = { opts: null, scores: null, col: 0, preview: null };
  async function openAbilities() {
    if (!state.worker) return;
    let o;
    try { o = await state.worker.call('abilityOptions', {}); } catch (e) { return; }
    ab.opts = o; ab.scores = o.cols.map((c) => c.scores.slice()); ab.col = 0; ab.preview = o.preview;
    $('#ap-explain').textContent = o.explain || 'Nothing yet.';
    renderAbilities();
    $('#abil-panel').showModal();
  }
  const COL_NOTES = {
    base: 'Your scores before bonuses: point buy (27 points, 8 to 15), the standard array (15, 14, 13, 12, 10, 8) or rolled.',
    background: 'Your background lets you add +2 and +1, or +1 to three of its abilities.',
    feats: 'Bonuses from feats.', levels: 'Ability Score Improvements from class levels.', items: 'Bonuses from magic items.',
    override: 'A magical score that replaces the total, such as a Headband of Intellect (19).', maximum: 'The highest the total can go (normally 20).',
  };
  function renderAbilities() {
    const tabs = $('#ap-cols');
    tabs.textContent = '';
    ab.opts.cols.forEach((c, i) => {
      if (!c.editable) return;
      const t = el('button', { type: 'button', role: 'tab', 'aria-selected': i === ab.col ? 'true' : 'false', text: c.name });
      t.addEventListener('click', () => { ab.col = i; renderAbilities(); });
      tabs.append(t);
    });
    const col = ab.opts.cols[ab.col];
    $('#ap-colnote').textContent = COL_NOTES[col.type] || 'Your own column.';
    const box = $('#ap-rows');
    box.textContent = '';
    const n = ab.opts.hos ? 7 : 6;
    for (let s = 0; s < n; s++) {
      const name = s < 6 ? ab.opts.names[s] : ab.opts.hos;
      const input = el('input', { cls: 'in num', inputmode: 'numeric', value: String(ab.scores[ab.col][s]), 'aria-label': name + ', ' + col.name });
      const setV = (v) => { ab.scores[ab.col][s] = v; input.value = String(v); previewSoon(); };
      input.addEventListener('change', () => setV(Number(input.value) || 0));
      const minus = el('button', { cls: 'btn', type: 'button', text: '−', 'aria-label': name + ' one less' });
      const plus = el('button', { cls: 'btn', type: 'button', text: '+', 'aria-label': name + ' one more' });
      minus.addEventListener('click', () => setV(ab.scores[ab.col][s] - 1));
      plus.addEventListener('click', () => setV(ab.scores[ab.col][s] + 1));
      const p = ab.preview && ab.preview[s];
      box.append(el('div', { cls: 'ap-row' }, [
        el('span', {}, [el('b', { text: name }), el('div', { cls: 'hint', text: 'Now ' + (ab.opts.current[s] || '–') })]),
        el('span', { cls: 'stepper' }, [minus, input, plus]),
        el('span', { cls: 'tot num', 'data-tot': String(s) }, [document.createTextNode(p ? String(p.total) : '–'), el('small', { text: p ? 'max ' + p.max : '' })]),
      ]));
    }
    showPointBuy();
  }
  function showPointBuy() {
    const pb = ab.preview ? ab.preview.slice(0, 6).reduce((a, x) => a + (Number(x.cost) || 0), 0) : 0;
    const base = ab.scores[0].slice(0, 6);
    $('#ap-pb').textContent = ab.opts.cols[ab.col].type === 'base' ? (base.every((v) => v >= 8 && v <= 15) ? 'Point buy: ' + pb + ' of 27 points used.' : 'Point buy only covers 8 to 15; these are rolled or set scores.') : '';
  }
  let previewTimer = 0;
  function previewSoon() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try { ab.preview = await state.worker.call('abilityPreview', { scores: ab.scores }); } catch (e) { return; }
      for (const t of $$('#ap-rows [data-tot]')) { const p = ab.preview[Number(t.dataset.tot)]; t.firstChild.textContent = String(p.total); t.querySelector('small').textContent = 'max ' + p.max; }
      showPointBuy();
    }, 120);
  }
  async function applyAbilities() {
    $('#abil-panel').close();
    const res = await send('applyAbilities', { scores: ab.scores });
    if (!res) return;
    if (res.errors.length) await showNotice(res.alerts.concat(res.errors.map((m) => ({ title: 'Script error', msg: m }))), 'MPMB reported a problem');
    else toast('Ability scores applied.');
  }
  function wireClassAbility() {
    $('#class-open').addEventListener('click', () => openClasses());
    $('#cf-rebuild').addEventListener('click', async () => {
      const res = await send('rebuildClassText', {});
      if (res && res.errors.length) await showNotice(res.errors.map((m) => ({ title: 'Script error', msg: m })), 'MPMB reported a problem');
      else if (res) toast('Feature texts rebuilt.');
    });
    $('#xp-levelup-btn').addEventListener('click', () => { const m = /level (\d+)/.exec($('#xp-levelup-text').textContent); openClasses(m ? Number(m[1]) : undefined); });
    $('#cp-close').addEventListener('click', () => $('#class-panel').close());
    $('#cp-add').addEventListener('click', () => { cls.rows.push({ cls: '', sub: '', level: 1 }); renderClasses(); });
    $('#cp-apply').addEventListener('click', applyClasses);
    $('#abil-open').addEventListener('click', openAbilities);
    $('#ap-close').addEventListener('click', () => $('#abil-panel').close());
    $('#ap-apply').addEventListener('click', applyAbilities);
  }

  // ---------------------------------------------------------------- the character written into the PDF
  async function downloadPdf() {
    const btn = $('#save-pdf'), status = $('#save-pdf-status');
    if (!state.worker) return;
    btn.disabled = true; status.hidden = false; status.textContent = 'Writing the character into the PDF…';
    const prev = state.worker.onProgress;
    state.worker.onProgress = (t) => { status.textContent = t + '…'; };
    setBusy(1);
    try {
      const res = await state.worker.call('savePdf', {});
      const who = shown(state.snap.get('PC Name')).trim();
      const base = state.fileName.replace(/\.pdf$/i, '');
      const filename = ((who ? who + ' - ' : '') + base).replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 180) + '.pdf';
      const blob = new Blob([res.bytes], { type: 'application/pdf' });
      // in a Claude artifact the viewer confirms the save; elsewhere a normal download
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
      if (dl) {
        try { await dl.save({ filename, data: blob }); status.textContent = 'Saved ' + filename + ' (' + kb(blob.size) + ').'; }
        catch (e) { status.textContent = e && e.code === 'declined' ? 'Download cancelled.' : 'The download didn’t work here (' + ((e && e.code) || e) + ').'; }
      } else {
        const a = el('a', { href: URL.createObjectURL(blob), download: filename });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        status.textContent = 'Downloaded ' + filename + ' (' + kb(blob.size) + ', written in ' + fmtS(res.ms) + ').';
      }
      if (res.report.skipped.length) status.textContent += ' Some parts couldn’t be written: ' + res.report.skipped.slice(0, 3).join('; ') + '.';
    } catch (e) {
      status.textContent = 'Writing the PDF failed: ' + (e.message || e);
    } finally { setBusy(-1); btn.disabled = false; state.worker.onProgress = prev; }
  }

  // ---------------------------------------------------------------- talking to MPMB
  function setBusy(d) { state.busy += d; $('#busy').classList.toggle('on', state.busy > 0); }
  function wireWorker(w) {
    w.onProgress = (t) => { $('#loading-text').textContent = t; };
    w.onStuck = (op) => recoverFromStuck(op);
    w.onAsk = (req) => (req.kind === 'question' ? askYesNo(req).then((yes) => ({ yes })) : req.kind === 'dialog' ? mpmbDialog.show(req) : null);
    // a request finished: a dialog its handlers ended is over (on a waiting page); during a replayed change the
    // stopped dialog's own requests finish while it stays open, and userChange closes it
    w.onIdle = () => { if (!state.changing) mpmbDialog.idle(); };
  }

  // ---- MPMB's dialogs by restart and replay (worker.js op run; replay.js has the same loop for the Node tests)
  // A change a person makes runs with stopping on. If MPMB opens a dialog (or asks a yes/no question) nobody can
  // answer, it stops there; the dialog is shown and every change the user makes in it runs MPMB's handler in the
  // stopped copy. Then a fresh copy starts from the character as it was before the change and makes the change again
  // with the user's answers, and becomes the live copy. On a page that can wait (cross-origin isolated) the worker asks
  // the user directly instead (onAsk).
  const USER_OPS = new Set(['commit', 'toggle', 'press', 'tap', 'shootAmmo', 'addPage', 'applyClasses', 'applyAbilities', 'chooseSpells', 'removeSpells', 'tapSpellRow']);
  // a spare copy: a worker with the sheet model and the PDF, MPMB not started until it is needed
  function makeSpare() {
    if (state.spare || !state.modelJSON || !state.worker || state.worker.asks) return;
    const w = connect();
    wireWorker(w);
    state.spare = { w, ready: w.call('prepare', { model: state.modelJSON, bytes: state.bytes.slice(0), fileName: state.fileName }) };
    state.spare.ready.catch(() => { if (state.spare && state.spare.w === w) state.spare = null; w.terminate(); });
  }
  function dropSpare() { if (state.spare) { state.spare.w.terminate(); state.spare = null; } }
  async function freshCopy(before) {
    if (!state.modelJSON) state.modelJSON = await state.worker.call('modelJSON', {});
    makeSpare();
    const sp = state.spare;
    state.spare = null;
    await sp.ready;
    await sp.w.call('startFrom', { state: before, watch: Array.from(state.snap.keys()) });
    setTimeout(makeSpare, 1000);
    return sp.w;
  }
  async function userChange(op, args) {
    let w = state.worker, before = null;
    const answers = [];
    state.changing = true;
    try {
      for (let round = 0; round <= 12; round++) {
        const res = await w.call('run', { op, args, answers });
        if (!res || !res.stopped) {
          if (w !== state.worker) {
            // the copy that made the change is the live one now; the screen catches up with all of it
            const old = state.worker;
            state.worker = w;
            old.terminate();
            const snaps = await w.call('watch', { names: Array.from(state.snap.keys()) });
            for (const s of snaps) apply(s);
          }
          return res;
        }
        if (!before) before = res.before;
        setBusy(-1);
        try {
          if (res.stopped.kind === 'question') {
            answers.push({ kind: 'question', yes: await askYesNo(res.stopped) });
          } else {
            // the stopped dialog, live: MPMB's handlers run in that copy as the user changes it
            const replies = [];
            let req = res.stopped;
            for (;;) {
              const reply = await mpmbDialog.show(req);
              replies.push(reply);
              const st = await w.call('stoppedStep', { reply });
              if (st.ended !== null) break;
              req = st.request;
            }
            mpmbDialog.idle();
            answers.push({ kind: 'dialog', name: res.stopped.name, replies });
          }
        } finally { setBusy(1); }
        const next = await freshCopy(before);
        if (w !== state.worker) w.terminate();
        w = next;
      }
      throw new Error('MPMB kept asking: more than 12 dialogs in one change');
    } finally { state.changing = false; }
  }
  async function send(op, args) {
    setBusy(1);
    try {
      const res = await (USER_OPS.has(op) && state.worker && !state.worker.asks ? userChange(op, args) : state.worker.call(op, args));
      for (const s of res.changes || []) apply(s);
      if (res.log) state.log = res.log;
      refreshDerived();
      if (op !== 'chooseSpells' && op !== 'removeSpells') spellsSoon();   // class, level, feats and so on change the spell choices
      saveSoon();
      return res;
    } catch (e) {
      state.log = state.log || { errors: [] };
      state.log.errors.push({ where: 'app', msg: String(e.message || e) });
      renderLog();
    } finally { setBusy(-1); }
  }
  function wireEvents() {
    document.addEventListener('change', (e) => {
      const n = e.target.closest && e.target.closest('[data-f],[data-pick]');
      if (!n || !state.worker) return;
      if (n.dataset.pick) {
        const it = ((state.snap.get(n.dataset.pick) || {}).items || [])[Number(n.value)];
        send('commit', { name: n.dataset.pick, value: n.value === '' || !it ? '' : it[1], index: n.value === '' ? undefined : Number(n.value) });
        return;
      }
      send('commit', { name: n.dataset.f, value: n.value });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches && e.target.matches('input[data-f]')) { e.preventDefault(); e.target.blur(); }
    });
    document.addEventListener('click', async (e) => {
      const t = e.target.closest && e.target.closest('[data-toggle],[data-skill],[data-tab],[data-goto],[data-mpmb],[data-bookmark],[data-step],[data-shoot]');
      if (!t) return;
      if (t.dataset.step && state.worker) { const cur = Number(shown(state.snap.get(t.dataset.step))) || 0; send('commit', { name: t.dataset.step, value: String(Math.max(0, cur + Number(t.dataset.by))) }); return; }
      if (t.dataset.shoot && state.worker) { send('shootAmmo', { side: t.dataset.shoot }); return; }
      if (t.dataset.tab) { e.preventDefault(); goTo(t.dataset.tab); return; }
      if (t.dataset.goto) { e.preventDefault(); goTo(t.dataset.goto, 'sheetinfo'); return; }
      if (!state.worker) return;
      if (t.dataset.mpmb || t.dataset.bookmark) { tapMpmb(t); return; }
      if (t.dataset.toggle) { send('toggle', { name: t.dataset.toggle }); return; }
      const f = t.dataset.skill;
      const prof = (state.snap.get(f + ' Prof') || {}).checked, exp = (state.snap.get(f + ' Exp') || {}).checked;
      // cycle: none → proficient → expertise → none
      if (!prof && !exp) await send('toggle', { name: f + ' Prof' });
      else if (prof && !exp) await send('toggle', { name: f + ' Exp' });
      else { if (exp) await send('toggle', { name: f + ' Exp' }); if ((state.snap.get(f + ' Prof') || {}).checked) await send('toggle', { name: f + ' Prof' }); }
    });
    const hpStep = (d) => {
      const cur = Number(shown(state.snap.get('HP Current'))) || 0;
      const max = Number(shown(state.snap.get('HP Max'))) || Infinity;
      send('commit', { name: 'HP Current', value: String(Math.max(0, Math.min(max, cur + d))) });
    };
    $('#hp-minus').addEventListener('click', () => hpStep(-1));
    $('#hp-plus').addEventListener('click', () => hpStep(1));
    $('#comp-add').addEventListener('click', async () => { if (!state.worker) return; await send('addPage', { key: 'AScomp' }); await refreshPages(); });
    $('#notes-add').addEventListener('click', async () => { if (!state.worker) return; await send('addPage', { key: 'ASnotes' }); await refreshPages(); });
    $('#ws-add').addEventListener('click', async () => { if (!state.worker) return; await send('addPage', { key: 'WSfront' }); await refreshPages(); });
    $('#notes-clear-open').addEventListener('click', () => { if (state.worker) clearNotesPages(); });
    $('#stuck-ok').addEventListener('click', () => $('#stuck').close());
    $('#stuck-clear').addEventListener('click', () => { $('#stuck').close(); if (state.worker) clearNotesPages(); });
    $('#save-pdf').addEventListener('click', downloadPdf);
    // phones close apps in the background without warning: save right away when the page is hidden
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) { clearTimeout(saveTimer); saveTimer = 0; saveNow(); } });
    // a new character: forget the saved one (add-on content stays) and open the sheet fresh; tap twice to confirm
    let armedNew = 0;
    $('#new-char').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (Date.now() > armedNew) {
        armedNew = Date.now() + 4000; b.textContent = 'Tap again: this clears the current character'; b.classList.add('danger');
        setTimeout(() => { b.textContent = 'Start a new character'; b.classList.remove('danger'); }, 4000);
        return;
      }
      armedNew = 0; clearTimeout(saveTimer);
      await idbDel(state.charKey);
      state.savedAt = 0;
      $('#sheet').hidden = true; $('#start').hidden = false;
      openSheet(state.bytes.slice(0), state.fileName, false);
    });
    $('#open-other').addEventListener('click', () => { $('#sheet').hidden = true; $('#start').hidden = false; $('#loading').hidden = true; $('#start-actions').hidden = false; initStart(); });
  }

  // ---------------------------------------------------------------- tabs that follow the scroll
  const BANDS = ['main', 'combat', 'spells', 'features', 'gear', 'companion', 'wildshape', 'advlog', 'sheetinfo'];
  let spyLock = 0;
  function setTab(id) { for (const a of $$('[data-tab]')) a.setAttribute('aria-current', a.dataset.tab === id ? 'true' : 'false'); }
  function goTo(id, tab) {
    const b = document.getElementById(id);
    if (!b) return;
    setTab(tab || id);
    spyLock = Date.now() + 700;
    b.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }
  function spy() {
    if (Date.now() < spyLock) return;
    const line = window.innerHeight * 0.35;
    let cur = BANDS[0];
    for (const id of BANDS) { const b = document.getElementById(id); if (b && !b.hidden && b.getBoundingClientRect().top <= line) cur = id; }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = BANDS[BANDS.length - 1];
    setTab(cur);
  }
  let spyQueued = false;
  window.addEventListener('scroll', () => { if (spyQueued) return; spyQueued = true; requestAnimationFrame(() => { spyQueued = false; spy(); }); }, { passive: true });

  // ---------------------------------------------------------------- MPMB's menus, buttons and messages
  // A menu item's name can carry its source after a tab: "High Elf\t   [SRD'24 85]". Acrobat's menus show "&&" as one
  // "&" (MPMB writes "Visible D&&D logos").
  const splitName = (n) => { const p = String(n).replace(/&&/g, '&').split(/\t+/); return [p[0].trim(), p.slice(1).join(' ').trim()]; };
  // features: a Choose feature menu (class or species), where greyed-out choices get an explanation
  function pickFromMenu(items, title, features) {
    const dlg = $('#menu');
    return new Promise((resolve) => {
      const stack = [{ items, title }];
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (dlg.open) dlg.close(); resolve(v); };
      const render = () => {
        const top = stack[stack.length - 1];
        $('#menu-title').textContent = top.title;
        $('#menu-back').hidden = stack.length < 2;
        const ul = $('#menu-list');
        ul.textContent = '';
        for (const it of top.items) {
          if (it.name === '-' || it.name === '') { ul.append(el('li', { cls: 'sep', role: 'separator' })); continue; }
          const [main, sub] = splitName(it.name);
          const leaf = !it.items;
          if (leaf && !it.enabled && !it.marked && (!it.ret || it.ret === it.name)) { ul.append(el('li', { cls: 'label', text: main })); continue; }
          const b = el('button', { type: 'button' }, [el('span', { cls: 'mk', text: it.marked ? '✓' : '' }), el('span', { text: main }), el('span', { cls: 'go', text: leaf ? '' : '›' })]);
          if (sub) b.append(el('span', { cls: 'sub', text: sub }));
          if (leaf && !it.enabled) b.disabled = true;
          b.addEventListener('click', () => { if (leaf) finish(it.ret); else { stack.push({ items: it.items, title: main }); render(); $('#menu-list').scrollTop = 0; } });
          ul.append(el('li', {}, [b]));
        }
        // MPMB greys out feature choices whose requirement isn't met, as in Acrobat; say why, since it looks broken otherwise.
        // (Line menus grey out things that explain themselves, such as Move up on the first line.)
        const greyed = !features ? [] : top.items.filter((it) => !it.items && !it.enabled && !it.marked && it.ret && it.ret !== it.name).map((it) => splitName(it.name)[0]);
        if (greyed.length) {
          const skillNames = SKILLS.map((s) => s[1]);
          const why = new Set();
          for (const n of greyed) {
            if (skillNames.indexOf(n.replace(/ Expertise$/i, '')) !== -1) why.add('Expertise needs proficiency in that skill first: tick the skill’s dot under Skills on the Main tab, then choose again.');
            else if (/^(Agonizing Blast|Eldritch Spear|Repelling Blast): /.test(n)) why.add('A cantrip upgrade needs that cantrip among your Warlock spells first (Choose spells on the Spells tab).');
            else if (/\(req: /.test(n)) why.add('The requirement is in brackets after the name (a level, a pact or another invocation).');
            else if (/level\s+\d+\+/i.test(top.title)) why.add('These need a higher level in the class.');
            else why.add('Greyed-out choices don’t meet a requirement yet, as on the PDF (a level, a proficiency, a spell or an earlier choice).');
          }
          ul.prepend(el('li', { cls: 'note', text: [...why].join(' ') }));
        }
      };
      $('#menu-back').onclick = () => { stack.pop(); render(); };
      $('#menu-close').onclick = () => finish(null);
      dlg.onclose = () => { if (!dlg.open) finish(null); };   // a late close event from the last menu doesn't cancel this one
      render();
      dlg.showModal();
    });
  }
  function showNotice(alerts, title) {
    const dlg = $('#notice');
    $('#notice-title').textContent = title || (alerts[0] && alerts[0].title) || 'MPMB';
    const body = $('#notice-body');
    body.textContent = '';
    for (const a of alerts) {
      if (alerts.length > 1 && a.title) body.append(el('b', { text: a.title }));
      body.append(el('div', { cls: 'notice-msg', text: String(a.msg || '').trim() }));
    }
    return new Promise((resolve) => { $('#notice-close').onclick = () => dlg.close(); dlg.onclose = () => resolve(); dlg.showModal(); });
  }
  function askYesNo(q) {
    const dlg = $('#ask');
    $('#ask-title').textContent = q.title || 'MPMB asks';
    $('#ask-msg').textContent = String(q.msg || '').trim();
    // the buttons answer straight away; the close event (Esc, back) only counts as No. Chrome can deliver a close event
    // late (a page in the background), and it mustn't answer the next question.
    return new Promise((resolve) => {
      $('#ask-yes').onclick = () => { resolve(true); dlg.close(); };
      $('#ask-no').onclick = () => { resolve(false); dlg.close(); };
      dlg.onclose = () => { if (!dlg.open) resolve(false); };
      dlg.showModal();
    });
  }
  let toastTimer = 0;
  function toast(text) {
    let t = $('#toast');
    if (!t) { t = el('div', { id: 'toast', cls: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  // A tap on one of MPMB's buttons: run it; if it opens a menu, ask, then run it again with the choice
  // data-mpmb: the button's field name; data-bookmark: a bookmark path ("Functions/Spells Options"); data-modifier: Ctrl-click
  // ---------------------------------------------------------------- pictures (MPMB's portrait, symbol, companion picture)
  // A button's picture as an image URL, by the picture it shows (engine iconKey): one the user picked comes as it is;
  // MPMB's own icons and pictures added in Acrobat come as a one-page PDF (worker iconImage), drawn with pdf.js
  const iconCache = new Map();   // icon key -> object URL ('' when it can't be shown)
  let pdfjsP = null;
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  function pdfjs() {
    if (!pdfjsP) pdfjsP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = () => {
        const L = window.pdfjsLib;
        if (!L || !L.GlobalWorkerOptions) { pdfjsP = null; reject(new Error('pdf.js not loaded')); return; }
        // a worker from another site can't be started directly: start one here that loads it
        try { L.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob(['importScripts("' + PDFJS + 'pdf.worker.min.js")'], { type: 'text/javascript' }))); }
        catch (e) { L.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; }
        resolve(L);
      };
      s.onerror = () => { pdfjsP = null; reject(new Error('pdf.js not loaded')); };
      document.head.appendChild(s);
    });
    return pdfjsP;
  }
  const b64Blob = (b64, mime) => { const t = atob(b64), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return new Blob([u], { type: mime }); };
  async function loadIcon(name) {
    const r = await state.worker.call('iconImage', { name });
    if (r.img) return URL.createObjectURL(b64Blob(r.img.data, r.img.mime));
    if (!r.pdf) return '';
    const L = await pdfjs();
    const doc = await L.getDocument({ data: r.pdf }).promise;
    try {
      const page = await doc.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(6, 640 / v1.width) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      // intent print: drawn straight away, also while the page is in the background (on screen pdf.js waits for frames)
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise;
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      return blob ? URL.createObjectURL(blob) : '';
    } finally { doc.destroy(); }
  }
  async function showIcon(n, snap) {
    const key = snap.exists && snap.icon ? snap.icon : '';
    if (n.dataset.key === key) return;
    n.dataset.key = key;
    const img = n.querySelector('img');
    let url = key ? iconCache.get(key) : '';
    if (url === undefined) {
      try { url = await loadIcon(snap.name); } catch (e) { url = ''; console.warn('Picture of ' + snap.name + ' not shown:', e); }
      iconCache.set(key, url);
    }
    if (n.dataset.key !== key) return;
    if (url) img.src = url; else img.removeAttribute('src');
  }
  // a picture button, as on the sheet (w × h: the button's proportions)
  const picture = (field, label, w, h, cls) => el('figure', { cls: 'pic' + (cls ? ' ' + cls : '') }, [
    el('button', { cls: 'pic-btn', type: 'button', 'data-mpmb': field, 'data-icon': field, 'data-title': label, 'aria-label': label + ': picture options', style: 'aspect-ratio: ' + w + ' / ' + h }, [el('img', { alt: label })]),
    el('figcaption', { text: label }),
  ]);
  // The image the user picks for MPMB ("Set any image/pdf file as Portrait"), made a sensible size for a sheet
  // (1600 px at most): JPEG, or PNG when it has see-through parts
  async function readPicture(file) {
    const bmp = await createImageBitmap(file);
    const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, w, h);
    let alpha = false;
    if (!/jpe?g/i.test(file.type)) { const d = g.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; } }
    if (!alpha) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
    const mime = alpha ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((res) => c.toBlob(res, mime, 0.9));
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), mime, data, w, h };
  }
  // the file picker opens straight away while the tap that started it still counts; otherwise after one more tap
  function pickPicture(label) {
    return new Promise((resolve) => {
      const dlg = $('#picpick'), input = $('#picpick-file');
      let done = false;
      const finish = async (file) => {
        if (done) return;
        done = true;
        if (dlg.open) dlg.close();
        input.onchange = null; $('#picpick-cancel').onclick = null;
        if (!file) { resolve(null); return; }
        try { resolve(await readPicture(file)); } catch (e) { toast('That image couldn’t be read.'); resolve(null); }
      };
      input.value = '';
      input.onchange = () => finish(input.files && input.files[0]);
      $('#picpick-cancel').onclick = () => finish(null);
      $('#picpick-note').textContent = 'MPMB asks for a picture for ' + label + '. Any image works; it goes into the PDF with your character.';
      const active = navigator.userActivation ? navigator.userActivation.isActive : false;
      if (active) {
        // a picker closed without a file doesn't always send an event: coming back to the page without one is a cancel
        const back = () => { window.removeEventListener('focus', back); setTimeout(() => { if (!input.files || !input.files.length) finish(null); }, 600); };
        window.addEventListener('focus', back);
        input.click();
      } else dlg.showModal();
    });
  }

  async function tapMpmb(btn) {
    const name = btn.dataset.mpmb, title = btn.dataset.title || btn.textContent.trim();
    // a bookmark whose name has a slash ("Auto/Manual") is written with "|" between the levels
    const bm = btn.dataset.bookmark;
    const where = bm ? { bookmark: bm.split(bm.indexOf('|') !== -1 ? '|' : '/') } : { name, modifier: btn.dataset.modifier === '1' };
    const answers = [], yes = [];
    let icon = null;
    for (let i = 0; i < 10; i++) {
      const res = await send('tap', Object.assign({ answers, yes }, icon ? { icon } : {}, where));
      if (!res) return;
      // MPMB asked for a picture (its picture menu, "Set any image/pdf file as …"): ask the user, then tap again with it
      if (res.iconWanted && !icon) {
        icon = await pickPicture(title);
        if (!icon) return;
        continue;
      }
      // MPMB asked a yes/no question (answered No for now): ask the user; on Yes, run it again with Yes
      if (res.question) {
        if (!(await askYesNo(res.question))) return;
        yes.push(true);
        continue;
      }
      if (res.menu) {
        const ret = await pickFromMenu(res.menu, title, name === 'Class Features Menu' || name === 'Race Features Menu');
        if (ret === null) return;
        answers.push(ret);
        continue;
      }
      if (res.alerts && res.alerts.length) await showNotice(res.alerts);
      else if (btn.dataset.done) toast(btn.dataset.done);
      if (btn.dataset.pages) { refreshPages(); spellsSoon(); }
      return;
    }
  }

  // ---------------------------------------------------------------- the sheet's extra pages (Set Pages Layout)
  const PAGE_NAMES = { ASfront: 'Third page (conditions, magic items, extra equipment)', ASoverflow: 'Overflow page (more magic items, feats, actions)',
    ASbackgr: 'Background and organisation page', AScomp: 'Companion page', ASnotes: 'Notes page', WSfront: 'Wild Shapes page', ALlog: 'Adventurers Logsheet', SSfront: 'Spell sheet' };
  async function refreshPages() {
    let list;
    try { list = await state.worker.call('pageList', {}); } catch (e) { return; }
    state.pages = list;
    const ul = $('#page-list');
    ul.textContent = '';
    for (const p of list) {
      const n = p.multi ? p.prefixes.length : (p.shown ? 1 : 0);
      ul.append(el('li', {}, [el('span', { cls: 'grow', text: PAGE_NAMES[p.key] || p.key }), el('span', { cls: n ? 'chip' : 'chip muted', text: p.multi ? (n ? n + '×' : 'none') : (n ? 'shown' : 'hidden') })]));
    }
    const notes = list.filter((p) => p.key === 'ASnotes')[0];
    $('#notes-clear-open').hidden = !(notes && notes.prefixes.length);
    await syncCompanions(list);
    await syncWildShapes(list);
    await syncLogs(list);
    await syncNotes(list);
  }

  // ---------------------------------------------------------------- spells
  // options: MPMB's choices per caster (spells.js options); sheet: the generated spell list
  let spellTimer = 0;
  function spellsSoon() { clearTimeout(spellTimer); spellTimer = setTimeout(refreshSpells, 250); }
  async function refreshSpells() {
    if (!state.worker || $('#picker').open) return;
    try {
      state.spellOpts = await state.worker.call('spellOptions', {});
      state.sheet = await state.worker.call('spellSheet', {});
    } catch (e) { return; }
    renderCasters(); renderSpellList();
  }
  const firstColTag = { atwill: 'At will', markedbox: 'Always prepared', oncelr: '1/long rest', oncesr: '1/short rest', onceday: '1/day', 'oncelr+markedbox': '1/long rest', 'oncesr+markedbox': '1/short rest', known: 'Known' };
  function renderCasters() {
    const box = $('#casters');
    const o = state.spellOpts;
    box.textContent = '';
    if (!o || !o.casters.length) { box.append(el('p', { cls: 'note', text: 'No spellcasting yet. Choose a class, species or feat that casts spells.' })); return; }
    const heads = (state.sheet && state.sheet.casters) || [];
    for (const c of o.casters) {
      const h = heads.filter((x) => x.key === c.key)[0];
      const figs = [];
      if (h) figs.push('DC ' + h.dc, 'Attack ' + (/^[+-]/.test(h.attack) ? h.attack : '+' + h.attack));
      if (c.cantrips) figs.push('Cantrips ' + c.cantrips.chosen.length + '/' + c.cantrips.count);
      if (c.spells) figs.push((c.spells.book ? 'Spellbook ' : 'Spells ') + c.spells.chosen.length + (c.spells.book ? '' : '/' + c.spells.count));
      // "Prepared spells only" uses the picks; the other lists have a prepared box per spell
      const ticked = ((state.sheet && state.sheet.rows) || []).filter((r) => r.caster === c.key && r.toggles === 'prepared' && r.on).length;
      if (c.prepared && c.prepared.count) figs.push('Prepared ' + (c.show && c.show.value === 3 ? c.prepared.chosen.length : ticked) + '/' + c.prepared.count);
      const btn = el('button', { cls: 'btn primary', type: 'button', text: 'Choose spells' });
      btn.addEventListener('click', () => openPicker(c.key));
      box.append(el('div', { cls: 'caster' }, [el('b', { text: c.fullname || c.name }), el('div', { cls: 'figs num', text: figs.join(' · ') }), btn]));
    }
  }
  function renderSpellList() {
    const s = state.sheet;
    const box = $('#spell-list');
    box.textContent = '';
    const rows = (s && s.rows) || [];
    $('#spell-actions').hidden = !(s && s.pages);
    $('#spell-count').textContent = rows.length ? rows.length + (rows.length === 1 ? ' spell' : ' spells') : 'None yet';
    if (!rows.length) { box.append(el('p', { cls: 'note', text: s && s.pages ? 'The spell list is empty.' : 'Tap Choose spells: the spells you prepare (and your cantrips) show here, with MPMB’s details.' })); return; }
    const heads = s.casters;
    const casterOrder = [];
    for (const r of rows) if (casterOrder.indexOf(r.caster) === -1) casterOrder.push(r.caster);
    for (const ck of casterOrder) {
      const h = heads.filter((x) => x.key === ck)[0];
      if (casterOrder.length > 1 || h) box.append(el('div', { cls: 'caster-head', text: h ? h.title : ck }));
      let level = null, ul = null;
      for (const r of rows.filter((x) => x.caster === ck)) {
        if (r.level !== level || !ul) { level = r.level; box.append(el('div', { cls: 'spell-level', text: level === null ? 'Other' : LEVEL_NAMES[level] })); ul = el('ul', { cls: 'spells-ul' }); box.append(ul); }
        // the first column: prepared (checkbox) or used (once per rest), toggled by MPMB's own button
        let left = el('span');
        if (r.toggles && r.button) {
          left = el('button', { cls: 'dot sm', type: 'button', 'aria-pressed': r.on ? 'true' : 'false', 'aria-label': r.name + (r.toggles === 'prepared' ? ' prepared' : ' used') });
          left.addEventListener('click', async () => { const res = await send('tapSpellRow', { button: r.button }); if (res) { state.sheet = res.sheet; renderSpellList(); renderCasters(); } });
        }
        const nameBtn = el('button', { cls: 'sp-name', type: 'button', text: r.name });
        nameBtn.addEventListener('click', () => showSpell(r.key, r.name));
        const tagText = firstColTag[r.first] || (r.toggles === 'prepared' ? '' : r.first && r.first.length <= 4 ? r.first.toUpperCase() : '');
        const tag = tagText ? el('span', { cls: 'tag', text: tagText + (r.toggles === 'used' && r.on ? ', used' : '') }) : null;
        const save = r.save && !/^[–-]$/.test(r.save) ? r.save + ' save' : '';
        const meta = [r.time, r.range, r.components, r.duration, save, r.school.trim(), r.book ? r.book + ' ' + r.pageRef : ''].filter(Boolean).join(' · ');
        const more = r.button ? el('button', { cls: 'btn sm more', type: 'button', 'data-mpmb': r.button, 'data-modifier': '1', 'data-title': r.name, 'aria-label': r.name + ': options', text: '⋯' }) : el('span');
        ul.append(el('li', { cls: 'spell' }, [left, el('div', {}, [el('div', {}, [nameBtn].concat(tag ? [tag] : [])), el('div', { cls: 'meta', text: meta }), el('div', { cls: 'desc', text: r.description })]), more]));
      }
    }
  }
  async function showSpell(key, name) {
    const dlg = $('#spell-info');
    $('#si-title').textContent = name;
    const body = $('#si-body');
    body.textContent = 'Loading…';
    dlg.showModal();
    $('#si-close').onclick = () => dlg.close();
    let d = null;
    try { d = await state.worker.call('spellDetails', { key }); } catch (e) { /* shown below */ }
    body.textContent = '';
    if (!d) { body.append(el('p', { cls: 'note', text: 'No details found for this spell.' })); return; }
    $('#si-title').textContent = d.name;
    body.append(el('div', { cls: 'hint', text: [d.level === 0 ? 'Cantrip' : LEVEL_NAMES[d.level], d.school, d.ritual ? 'ritual' : ''].filter(Boolean).join(' · ') }));
    const dl = el('dl', { cls: 'kv' });
    for (const [k, v] of [['Casting time', d.time], ['Range', d.range], ['Components', d.components + (d.compMaterial ? ' (' + d.compMaterial + ')' : '')], ['Duration', d.duration], ['Save', d.save], ['Source', d.source]]) if (v) dl.append(el('dt', { text: k }), el('dd', { text: v }));
    body.append(dl);
    for (const p of String(d.text).replace(/\r\n?/g, '\n').split(/\n+/)) if (p.trim()) { const pe = el('p', { cls: 'notice-msg' }); inlineMarkup(p.trim(), pe); body.append(pe); }
  }

  // Choosing spells: the class spell list in one place (cantrips, then each level up to the highest the character can
  // cast), with a switch per spell: Known for cantrips; Book and Prepared for a spellbook caster; Prepared for a caster
  // that prepares from the whole list; Known for a known-spells caster. Saving makes the spell list right away, with
  // MPMB's "Prepared spells only" for casters that prepare, so the Spells tab shows what can be cast today.
  const picker = { caster: null, picks: null, mine: false, level: 'all', sort: 'level', search: '', open: new Set() };
  // the search, All/Mine, level and sort choices are remembered on this device (browser storage may be unavailable)
  const PREFS = 'mpmb-app:spell-picker';
  try { const p = JSON.parse(localStorage.getItem(PREFS) || '{}'); for (const k of ['mine', 'level', 'sort', 'search']) if (p[k] !== undefined) picker[k] = p[k]; } catch (e) { /* defaults */ }
  function savePickerPrefs() { try { localStorage.setItem(PREFS, JSON.stringify({ mine: picker.mine, level: picker.level, sort: picker.sort, search: picker.search })); } catch (e) { /* not kept */ } }
  const spellText = new Map();   // key -> full text from MPMB, fetched when a spell is unfolded
  function casterKind(c) { return c.spells && c.spells.book ? 'book' : c.prepared ? 'list' : c.spells ? 'known' : c.bonus ? 'bonus' : 'none'; }
  function openPicker(key) {
    const o = state.spellOpts;
    picker.picks = {};
    for (const c of o.casters) picker.picks[c.key] = { cantrips: new Set(c.cantrips ? c.cantrips.chosen : []), spells: new Set(c.spells ? c.spells.chosen : []), prepared: new Set(c.prepared ? c.prepared.chosen : []), bonus: c.bonus ? c.bonus.map((s) => s.chosen || '') : null };
    picker.caster = o.casters.filter((c) => c.key === key)[0];
    picker.open.clear();
    $('#picker-title').textContent = (picker.caster.name || picker.caster.key) + ': spells';
    $('#picker-search').value = picker.search;
    renderPicker();
    $('#picker').showModal();
    $('#picker-body').scrollTop = 0;
  }
  // the spells offered for each level: a spellbook or known-spells caster picks from MPMB's class list; a caster that
  // prepares from the whole list picks from MPMB's prepare list. Both stop at the highest level it can cast.
  function pickerRows(c) {
    const info = state.spellOpts.spells;
    const lvl = (k) => (info[k] ? info[k].level : 0);
    const max = c.maxLevel || 9;
    const rows = [];
    // MPMB marks rituals with " (R)" in its lists; the grey line under the name already says "ritual"
    const clean = (n) => String(n).replace(/\s*\(R\)\s*$/, '');
    if (c.cantrips) for (const s of c.cantrips.list) rows.push({ key: s.key, name: clean(s.name), level: 0 });
    const src = c.spells ? c.spells.list : c.prepared && !c.prepared.fromBook ? c.prepared.list : [];
    const seen = new Set();
    for (const s of src) if (lvl(s.key) >= 1 && lvl(s.key) <= max && !seen.has(s.key)) { seen.add(s.key); rows.push({ key: s.key, name: clean(s.name), level: lvl(s.key) }); }
    rows.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    return rows;
  }
  function pickerLimits(c) {
    const p = picker.picks[c.key], kind = casterKind(c);
    const out = [];
    if (c.cantrips) out.push({ id: 'cantrips', label: 'Cantrips', n: p.cantrips.size, max: c.cantrips.count });
    if (kind === 'book') out.push({ id: 'spells', label: 'Spellbook', n: p.spells.size, max: 0 });
    if (kind === 'known') out.push({ id: 'spells', label: 'Spells known', n: p.spells.size, max: c.spells.count });
    if (c.prepared && (c.prepared.count || kind === 'book')) out.push({ id: 'prepared', label: 'Prepared', n: p.prepared.size, max: c.prepared.count });
    if (c.bonus) out.push({ id: 'bonus', label: 'Bonus spells', n: p.bonus.filter(Boolean).length, max: c.bonus.length });
    return out;
  }
  function renderPicker() {
    const c = picker.caster, p = picker.picks[c.key], kind = casterKind(c);
    const limits = pickerLimits(c);
    const lim = {};
    for (const l of limits) lim[l.id] = l;
    const counts = $('#picker-counts');
    counts.textContent = '';
    for (const l of limits) counts.append(el('span', { cls: 'chip' + (l.max && l.n === l.max ? ' full' : l.max && l.n > l.max ? ' over' : ''), text: l.label + ' ' + l.n + (l.max ? '/' + l.max : '') }));
    counts.hidden = !limits.length;
    $('#picker-all').setAttribute('aria-pressed', picker.mine ? 'false' : 'true');
    $('#picker-mine').setAttribute('aria-pressed', picker.mine ? 'true' : 'false');
    $('#picker-bylevel').setAttribute('aria-pressed', picker.sort === 'level' ? 'true' : 'false');
    $('#picker-az').setAttribute('aria-pressed', picker.sort === 'name' ? 'true' : 'false');
    // level chips: only the levels this caster has on its list
    const allRows = pickerRows(c);
    const levels = [];
    for (const r of allRows) if (levels.indexOf(r.level) === -1) levels.push(r.level);
    if (picker.level !== 'all' && levels.indexOf(picker.level) === -1) picker.level = 'all';
    const chips = $('#picker-levels');
    chips.textContent = '';
    for (const lv of ['all'].concat(levels)) {
      const label = lv === 'all' ? 'Any level' : lv === 0 ? 'Cantrips' : LEVEL_NAMES[lv].replace(' level', '');
      chips.append(el('button', { type: 'button', 'data-level': String(lv), 'aria-pressed': picker.level === lv ? 'true' : 'false', text: label }));
    }
    const notes = { book: 'Add spells to your spellbook, then prepare the ones you want today.', list: 'Prepare the spells you want today from your class list.', known: 'Choose the spells you know.', bonus: 'Choose the spells this gives you.', none: 'There is nothing to choose here: MPMB adds these spells itself.' };
    $('#picker-note').textContent = notes[kind] + (c.maxLevel ? ' You can cast spells up to ' + LEVEL_NAMES[c.maxLevel].toLowerCase() + '.' : '');
    const q = picker.search.trim().toLowerCase();
    const info = state.spellOpts.spells;
    const ul = $('#picker-list');
    const body = $('#picker-body');
    const keep = body.scrollTop;
    ul.textContent = '';
    let level = null;
    const full = (id) => lim[id] && lim[id].max && lim[id].n >= lim[id].max;
    // bonus spells (Magic Initiate and the like): one drop-down per slot, from that slot's own list in MPMB
    if (c.bonus) {
      ul.append(el('li', { cls: 'lv', text: 'Bonus spells' }));
      c.bonus.forEach((slot, i) => {
        const id = 'pick-bonus-' + i;
        const sel = el('select', { cls: 'in', id, 'data-bonus': String(i) }, [el('option', { value: '', text: 'Choose a spell' })].concat(slot.list.filter((s) => s.name.trim()).map((s) => el('option', { value: s.key, text: s.name.replace(/\s*\(R\)\s*$/, '') }))));
        sel.value = p.bonus[i] || '';
        ul.append(el('li', { cls: 'pk-bonus' }, [el('label', { cls: 'f', for: id }, [el('span', { text: slot.label })]), sel]));
      });
    }
    const rows = allRows.slice();
    if (picker.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    for (const r of rows) {
      const isCantrip = r.level === 0;
      const mine = isCantrip ? p.cantrips.has(r.key) : p.spells.has(r.key) || p.prepared.has(r.key);
      if (picker.mine && !mine) continue;
      if (picker.level !== 'all' && r.level !== picker.level) continue;
      if (q && r.name.toLowerCase().indexOf(q) === -1) continue;
      // by level: a heading per level; A–Z: the level goes in the grey line instead
      if (picker.sort === 'level' && r.level !== level) { level = r.level; ul.append(el('li', { cls: 'lv', text: LEVEL_NAMES[level] })); }
      // the switches for this caster
      const pills = [];
      const pill = (part, label, on, disabled) => { const b = el('button', { cls: 'pill', type: 'button', 'aria-pressed': on ? 'true' : 'false', 'data-part': part, 'data-key': r.key, text: label, 'aria-label': label + ': ' + r.name }); b.disabled = !!disabled; pills.push(b); };
      if (isCantrip) pill('cantrips', 'Known', p.cantrips.has(r.key), !p.cantrips.has(r.key) && full('cantrips'));
      else if (kind === 'book') { pill('spells', 'Book', p.spells.has(r.key), false); pill('prepared', 'Prepared', p.prepared.has(r.key), !p.spells.has(r.key) || (!p.prepared.has(r.key) && full('prepared'))); }
      else if (kind === 'list') pill('prepared', 'Prepared', p.prepared.has(r.key), !p.prepared.has(r.key) && full('prepared'));
      else if (kind === 'known') pill('spells', 'Known', p.spells.has(r.key), !p.spells.has(r.key) && full('spells'));
      const d = info[r.key] || {};
      const open = picker.open.has(r.key);
      const li = el('li', { cls: 'pk' + (open ? ' open' : '') }, [
        el('div', { cls: 'pk-main' }, [
          el('button', { cls: 'pk-name', type: 'button', 'data-open': r.key, 'aria-expanded': open ? 'true' : 'false', text: r.name }),
          el('div', { cls: 'meta', text: [picker.sort === 'name' ? (r.level === 0 ? 'Cantrip' : LEVEL_NAMES[r.level]) : '', d.school, d.time, d.range, d.ritual ? 'ritual' : '', d.source].filter(Boolean).join(' · ') }),
        ]),
        el('div', { cls: 'pk-toggles' }, pills),
      ]);
      if (open) {
        const box = el('div', { cls: 'pk-text' });
        const t = spellText.get(r.key);
        if (t) { const dl = [t.components, t.duration].filter(Boolean).join(' · '); if (dl) box.append(el('div', { cls: 'hint', text: dl })); for (const para of String(t.text).replace(/\r\n?/g, '\n').split(/\n+/)) if (para.trim()) { const pe = el('p'); inlineMarkup(para.trim(), pe); box.append(pe); } }
        else box.append(el('p', { cls: 'muted', text: d.description || 'Loading…' }));
        li.append(box);
      }
      ul.append(li);
    }
    if (!ul.children.length && kind !== 'none') ul.append(el('li', { cls: 'note', text: q ? 'No spells match “' + q + '”.' : picker.mine ? 'Nothing chosen here yet. Switch to All to pick spells.' : 'Nothing to choose here.' }));
    $('#picker-bar').hidden = kind === 'none' || kind === 'bonus';
    body.scrollTop = keep;
  }
  async function unfoldSpell(key) {
    if (picker.open.has(key)) picker.open.delete(key); else picker.open.add(key);
    renderPicker();
    if (picker.open.has(key) && !spellText.has(key)) {
      try { const t = await state.worker.call('spellDetails', { key }); if (t) spellText.set(key, t); } catch (e) { /* the short description stays */ }
      renderPicker();
    }
  }
  function wireSpells() {
    $('#picker-list').addEventListener('change', (e) => {
      const s = e.target.closest('[data-bonus]');
      if (!s) return;
      picker.picks[picker.caster.key].bonus[Number(s.dataset.bonus)] = s.value;
      renderPicker();
    });
    $('#picker-list').addEventListener('click', (e) => {
      const o = e.target.closest('[data-open]');
      if (o) { unfoldSpell(o.dataset.open); return; }
      const b = e.target.closest('[data-part]');
      if (!b || b.disabled) return;
      const p = picker.picks[picker.caster.key], set = p[b.dataset.part], key = b.dataset.key;
      if (set.has(key)) { set.delete(key); if (b.dataset.part === 'spells') p.prepared.delete(key); }   // out of the book: not prepared either
      else set.add(key);
      renderPicker();
    });
    // changing what is shown starts the list from the top; the choices are remembered
    const refilter = () => { savePickerPrefs(); renderPicker(); $('#picker-body').scrollTop = 0; };
    $('#picker-search').addEventListener('input', (e) => { picker.search = e.target.value; refilter(); });
    $('#picker-all').addEventListener('click', () => { picker.mine = false; refilter(); });
    $('#picker-mine').addEventListener('click', () => { picker.mine = true; refilter(); });
    $('#picker-bylevel').addEventListener('click', () => { picker.sort = 'level'; refilter(); });
    $('#picker-az').addEventListener('click', () => { picker.sort = 'name'; refilter(); });
    $('#picker-levels').addEventListener('click', (e) => {
      const b = e.target.closest('[data-level]');
      if (!b) return;
      picker.level = b.dataset.level === 'all' ? 'all' : Number(b.dataset.level);
      refilter();
    });
    $('#picker-close').addEventListener('click', () => $('#picker').close());
    $('#picker-save').addEventListener('click', async () => {
      $('#picker').close();
      await makeSpellList(currentPicks());
    });
    $('#spells-update').addEventListener('click', () => makeSpellList(showPrepared({})));
    $('#spells-remove').addEventListener('click', async () => {
      const res = await send('removeSpells', {});
      if (res) { state.sheet = res.sheet; renderSpellList(); toast('Spell list removed.'); }
    });
  }
  // the picks for every caster as MPMB's spell dialogs keep them
  function currentPicks() {
    const picks = {};
    for (const k in picker.picks) { const p = picker.picks[k]; picks[k] = { cantrips: Array.from(p.cantrips), spells: Array.from(p.spells), prepared: Array.from(p.prepared) }; if (p.bonus) picks[k].bonus = p.bonus.slice(); }
    return showPrepared(picks);
  }
  // casters that prepare get MPMB's "Prepared spells only" (3), so the list shows what can be cast today;
  // known-spells casters show all their spells (2)
  function showPrepared(picks) {
    for (const c of (state.spellOpts && state.spellOpts.casters) || []) {
      if (!c.show) continue;
      picks[c.key] = picks[c.key] || {};
      picks[c.key].show = c.prepared && c.show.choices.some((x) => x.value === 3) ? 3 : 2;
    }
    return picks;
  }
  async function makeSpellList(picks) {
    const res = await send('chooseSpells', { picks: picks || {} });
    if (!res) return;
    state.sheet = res.sheet;
    renderSpellList();
    if (res.errors && res.errors.length) await showNotice(res.alerts.concat(res.errors.map((m) => ({ title: 'Script error', msg: m }))), 'MPMB reported a problem');
    else toast('Spell list ready: ' + res.sheet.rows.length + ' spells.');
    refreshSpells();
    goTo('spell-list-card', 'spells');
  }

  // ---------------------------------------------------------------- add-on content and sources
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const PLURAL = { class: 'classes', subclass: 'subclasses', species: 'species' };
  const countText = (c) => ['class', 'subclass', 'species', 'background', 'feat', 'spell', 'magic item', 'creature']
    .filter((k) => c[k]).map((k) => c[k] + ' ' + (c[k] === 1 ? k : PLURAL[k] || k + 's')).join(' · ');
  const listNames = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const inUse = (c) => c.sources.filter((s) => !s.excluded);

  function renderContent() {
    const c = state.content;
    if (!c) return;
    // files and the pasted script
    const ul = $('#content-files');
    ul.textContent = '';
    const removeBtn = (label, onConfirm) => {
      const b = el('button', { cls: 'btn sm', type: 'button', text: 'Remove', 'aria-label': 'Remove ' + label });
      let armed = 0;
      b.addEventListener('click', () => {
        if (Date.now() < armed) { onConfirm(); return; }
        armed = Date.now() + 4000; b.textContent = 'Tap again to remove'; b.classList.add('danger');
        setTimeout(() => { if (b.isConnected) { b.textContent = 'Remove'; b.classList.remove('danger'); } }, 4000);
      });
      return b;
    };
    for (const f of c.files) {
      ul.append(el('li', { cls: 'file-row' }, [
        el('div', {}, [el('div', { cls: 'fname', text: f.name }), el('div', { cls: 'hint', text: (f.date ? 'Added ' + f.date + ' · ' : '') + kb(f.size) })]),
        removeBtn(f.name, () => contentOp('removeContent', { key: f.key }, { removed: f.name })),
      ]));
    }
    if (c.userScript) {
      const edit = el('button', { cls: 'btn sm', type: 'button', text: 'Edit' });
      edit.addEventListener('click', () => openPaste(true));
      ul.append(el('li', { cls: 'file-row' }, [
        el('div', {}, [el('div', { cls: 'fname', text: 'Pasted script' }), el('div', { cls: 'hint', text: kb(c.userScript) })]),
        el('div', { cls: 'uses' }, [edit, removeBtn('the pasted script', () => contentOp('setUserScript', { text: '' }, { removed: 'the pasted script' }))]),
      ]));
    }
    if (!c.files.length && !c.userScript) ul.append(el('li', { cls: 'muted', text: 'No add-on content yet. The sheet has the SRD (the free rules) only.' }));
    const n = c.files.length;
    $('#content-chip').textContent = !n && !c.userScript ? 'SRD only' : (n ? n + (n === 1 ? ' file' : ' files') : '') + (n && c.userScript ? ' + ' : '') + (c.userScript ? 'script' : '');
    // sources, grouped like MPMB's Source Selection dialog
    const box = $('#source-list');
    box.textContent = '';
    let group = null;
    for (const s of c.sources) {
      if (s.group !== group) { group = s.group; box.append(el('div', { cls: 'src-group', text: group })); }
      const cb = el('input', { type: 'checkbox', 'data-source': s.key });
      cb.checked = !s.excluded;
      const counts = countText(s.counts);
      box.append(el('label', { cls: 'src' + (s.excluded ? ' off' : '') }, [
        cb,
        el('span', {}, [el('span', { cls: 'n', text: s.name }), el('span', { cls: 'abbr', text: s.abbr })]),
        el('span', { cls: 'hint', text: s.excluded ? 'Switched off' + (counts ? ' · ' + counts : '') : counts || 'In use' }),
      ]));
    }
    if (c.sources.length <= 1) box.append(el('p', { cls: 'note', text: 'Add a content file to choose from more books.' }));
    const used = inUse(c);
    $('#sources-chip').textContent = used.length + ' of ' + c.sources.length + ' in use';
    // the line in the Character card
    const onlySRD = !c.files.length && !c.userScript;
    $('#content-hint-text').textContent = onlySRD ? 'Content: SRD only.' : 'Content: ' + (used.map((s) => s.abbr).join(', ') || 'no books switched on') + (c.userScript ? ' + your script' : '') + '.';
    $('#content-hint-link').textContent = onlySRD ? 'Add books' : 'Change';
  }

  function contentBusy(on) {
    for (const n of $$('#content-file, #paste-open, #paste-save, #paste-cancel, #content-files button, [data-source]')) n.disabled = on;
    $('label[for="content-file"]').classList.toggle('is-disabled', on);
  }
  function showResult(kind, title, msgs) {
    const r = $('#content-result');
    r.textContent = '';
    r.className = 'result' + (kind ? ' ' + kind : '');
    r.append(el('div', { text: title }));
    for (const m of msgs || []) r.append(el('div', { cls: 'msg', text: m }));
    r.hidden = false;
  }
  // One content action in the sheet's engine; then save what MPMB stored and tell the user what happened
  async function contentOp(op, args, ctx) {
    const before = state.content;
    contentBusy(true);
    showResult('', ctx && ctx.working ? ctx.working : 'Working…');
    setBusy(1);
    let res;
    try { res = await state.worker.call(op, args); } catch (e) { setBusy(-1); contentBusy(false); showResult('err', 'Something went wrong: ' + (e.message || e)); return; }
    for (const s of res.changes || []) apply(s);
    state.log = res.log; state.content = res.content; state.saved = res.saved;
    idbPut(state.sheetKey, { saved: res.saved, date: Date.now() });
    renderContent(); refreshDerived(); spellsSoon(); saveSoon();
    setBusy(-1); contentBusy(false);
    // MPMB's own alerts: "Success!" only says it worked; anything else (errors, version warnings) is worth showing
    const worked = res.alerts.some((a) => /success/i.test(a.title));
    const other = res.alerts.filter((a) => !/success/i.test(a.title)).map((a) => (a.title ? a.title + '\n' : '') + a.msg.trim());
    const errs = res.errors.map((e) => 'Script error: ' + e);
    if (op === 'addContent') {
      if (!worked) { showResult('err', 'The file wasn’t added.', other.concat(errs)); return; }
      const had = new Set(before.sources.map((s) => s.key));
      const added = res.content.sources.filter((s) => !had.has(s.key));
      const off = added.filter((s) => s.excluded).map((s) => s.abbr);
      const lines = [];
      if (added.length) lines.push('New books: ' + added.map((s) => s.name).join(', ') + '.');
      if (off.length) lines.push(listNames(off) + (off.length === 1 ? ' is' : ' are') + ' switched off for now (MPMB does this for some books). Switch ' + (off.length === 1 ? 'it' : 'them') + ' on under Sources.');
      showResult('ok', 'Added ' + ctx.name + ' in ' + fmtS(res.ms) + '.', lines.concat(other, errs));
    } else if (op === 'setUserScript' && !(ctx && ctx.removed)) {
      if (worked) { showResult('ok', 'Your script was added to the sheet.', other.concat(errs)); $('#paste-box').hidden = true; $('#paste-open').setAttribute('aria-expanded', 'false'); }
      else showResult('err', 'The script wasn’t added. Your earlier content is unchanged.', other.concat(errs));
    } else if (ctx && ctx.removed) {
      showResult(other.length || errs.length ? 'err' : 'ok', 'Removed ' + ctx.removed + '.', other.concat(errs));
    } else if (other.length || errs.length) showResult('err', 'MPMB reported a problem.', other.concat(errs));
    else $('#content-result').hidden = true;
  }
  function openPaste(focus) {
    $('#paste-text').value = (state.saved && state.saved['User Script']) || '';
    $('#paste-box').hidden = false;
    $('#paste-open').setAttribute('aria-expanded', 'true');
    if (focus) $('#paste-text').focus();
  }
  function wireContent() {
    $('#content-file').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f || !state.worker) return;
      if (f.size > 25 * 1048576) { showResult('err', f.name + ' is too big for an add-on script (' + kb(f.size) + ').'); return; }
      const text = await f.text();
      if (/^%PDF-/.test(text)) { showResult('err', f.name + ' is a PDF. Pick an add-on script file (usually ending in .js).'); return; }
      contentOp('addContent', { text }, { name: f.name, working: 'Adding ' + f.name + '…' });
    });
    $('#paste-open').addEventListener('click', () => { if ($('#paste-box').hidden) openPaste(true); else { $('#paste-box').hidden = true; $('#paste-open').setAttribute('aria-expanded', 'false'); } });
    $('#paste-cancel').addEventListener('click', () => { $('#paste-box').hidden = true; $('#paste-open').setAttribute('aria-expanded', 'false'); });
    $('#paste-save').addEventListener('click', () => {
      const text = $('#paste-text').value;
      if (!text.trim()) { if (state.content && state.content.userScript) contentOp('setUserScript', { text: '' }, { removed: 'the pasted script' }); $('#paste-box').hidden = true; return; }
      contentOp('setUserScript', { text }, { working: 'Running your script…' });
    });
    $('#source-list').addEventListener('change', (e) => {
      if (!e.target.matches('[data-source]') || !state.content) return;
      const excluded = $$('[data-source]').filter((cb) => !cb.checked).map((cb) => cb.dataset.source);
      contentOp('setSources', { excluded }, { working: 'Updating the lists…' });
    });
  }

  // ---------------------------------------------------------------- sheet tab
  // Looks (the script in index.html sets them before the page draws): the open sheet's design and colours, and the picker
  const LOOKS = [['auto', 'Match my sheet'], ['colorful-white', 'Colorful, white'], ['colorful-dark', 'Colorful, dark'],
    ['pf-white', 'Printer friendly, white'], ['pf-dark', 'Printer friendly, dark'], ['pf-black', 'Printer friendly, black (OLED screens)']];
  const T = window.MPMBTheme;
  function sheetColors() {
    if (!T) return;
    const name = (n) => { const s = state.snap.get(n); return s && s.exists ? String(s.value || '').trim().toLowerCase() : ''; };
    const color = name('Color.Theme'), seal = name('Color.DragonHeads');
    T.sheet({ color: T.COLORS[color] ? color : undefined, seal: T.COLORS[seal] ? seal : undefined });
  }
  function renderLooks() {
    const box = $('#look-list');
    if (!box || !T) return;
    const hadFocus = box.contains(document.activeElement);
    box.textContent = '';
    const swatch = { 'colorful-white': ['#ffffff', 'var(--sheet)'], 'colorful-dark': ['#17141a', 'var(--sheet)'], 'pf-white': ['#ffffff', '#6b6b6b'], 'pf-dark': ['#1a1a1a', '#4d4d4d'], 'pf-black': ['#000000', '#2a2a2a'] };
    // "Match my sheet" shows the look it uses now (the sheet's design, the device's light or dark)
    const root = document.documentElement, now = root.getAttribute('data-look') + '-' + root.getAttribute('data-tone');
    const nowName = (LOOKS.find((l) => l[0] === now) || [now, now])[1];
    for (const [id, label] of LOOKS) {
      const input = el('input', { type: 'radio', name: 'look', value: id });
      input.checked = T.choice() === id;
      const sw = swatch[id] || swatch[now] || swatch['colorful-white'];
      const kids = [input, el('span', { cls: 'look-sw', 'aria-hidden': 'true' }), el('span', { text: label })];
      kids[1].append(el('i', { style: 'background:' + sw[0] }), el('i', { style: 'background:' + sw[1] }));
      if (id === 'auto') kids.push(el('span', { cls: 'hint', text: 'Now: ' + nowName + ' (your sheet’s design; light or dark as your device is)' }));
      box.append(el('label', { cls: 'look-opt' }, kids));
    }
    if (hadFocus) { const c = $('input[name=look]:checked', box); if (c) c.focus(); }
  }
  function wireLooks() {
    const box = $('#look-list');
    if (!box || !T) return;
    box.addEventListener('change', (e) => { if (e.target.name === 'look') T.choose(e.target.value); });
    T.onChange(renderLooks);
    renderLooks();
  }
  const fmtS =(ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms');
  function renderFacts() {
    const i = state.info, s = state.stats;
    $('#sheet-ver').textContent = 'MPMB v' + i.version + ' · ' + i.type;
    const dl = $('#sheet-facts');
    dl.textContent = '';
    const add = (k, v) => { dl.append(el('dt', { text: k }), el('dd', { text: v })); };
    add('App', APP_BUILD);
    add('Dialogs', state.worker && state.worker.asks ? 'Shown to you; MPMB waits for your answer' : 'Shown to you; MPMB makes the change again with your answer (restart and replay)');
    add('File', state.fileName + ' (' + (s.bytes / 1048576).toFixed(1) + ' MB)');
    add('Sheet', 'MPMB v' + i.version + ', ' + i.type);
    add('Contents', s.pages + ' pages, ' + s.templates + ' extra page templates, ' + s.fields.toLocaleString('en') + ' fields, ' + s.scripts + ' scripts');
    add('Opening', fmtS(s.openMs) + ' (reading the PDF ' + fmtS(s.loadMs) + ', starting MPMB ' + fmtS(s.startMs) + ')');
    add('Screen', window.innerWidth + ' × ' + window.innerHeight + ' at ' + Math.round((window.devicePixelRatio || 1) * 100) / 100 + '×');
  }
  function renderLog() {
    const box = $('#msgs');
    if (!box || !state.log) return;
    const items = [];
    for (const d of state.log.dialogs || []) items.push({ t: d.t || 0, cls: '', text: 'Asked: ' + (d.title || d.name) + ' → ' + (d.answered === 'app' ? 'answered by the app with your choices' : 'answered with ' + (d.answered === 'defaults' ? 'its default choices' : 'cancel')) + '.' });
    for (const a of state.log.alerts || []) items.push({ t: a.t || 0, cls: '', text: (a.title ? a.title + ': ' : '') + String(a.msg).replace(/\s+/g, ' ').slice(0, 220) + (a.msg.length > 220 ? '…' : '') });
    for (const m of state.log.menus || []) items.push({ t: m.t || 0, cls: '', text: 'Menu: ' + m.items.filter(Boolean).slice(0, 5).join(', ') });
    for (const e of state.log.errors || []) items.push({ t: Number.MAX_SAFE_INTEGER, cls: 'err', text: 'Error in ' + e.where + ': ' + e.msg + (e.at ? ' (' + e.at + ')' : '') });
    items.sort((a, b) => b.t - a.t);
    box.textContent = '';
    for (const it of items.slice(0, 60)) box.append(el('div', { cls: it.cls, text: it.text }));
    if (!items.length) box.append(el('div', { cls: 'muted', text: 'Nothing yet.' }));
    $('#msg-count').textContent = String(items.length);
  }
  // ---------------------------------------------------------------- go
  // Cards go into fixed columns, each into the shortest column so far, in reading order. They only move when the
  // number of columns changes (rotating, resizing), never because a card's content grows or folds.
  let gridCols = 0;
  const colCount = () => (window.innerWidth >= 1000 ? 3 : window.innerWidth >= 600 ? 2 : 1);
  // only: lay out just these grids (new or changed ones) at the current number of columns
  function layoutGrids(force, only) {
    const n = colCount();
    if (!only) {
      if (n === gridCols && !force) return;
      gridCols = n;
    }
    // a grid keeps its height while its cards are put back, so the page never gets shorter for a moment: a shorter
    // page pulls the scroll position up, and the screen jumped every time a card was shown or hidden
    const y = window.scrollY;
    for (const grid of only || $$('.grid')) {
      if (!grid._cards) grid._cards = Array.from(grid.children).filter((c) => c.classList.contains('card'));
      grid.style.minHeight = grid.offsetHeight + 'px';
      const cols = [];
      for (let i = 0; i < n; i++) cols.push(el('div', { cls: 'gcol' }));
      grid.textContent = '';
      for (const c of cols) grid.append(c);
      for (const card of grid._cards) {
        let best = cols[0];
        for (const c of cols) if (c.offsetHeight < best.offsetHeight) best = c;
        best.append(card);
      }
      grid.style.minHeight = '';
    }
    if (window.scrollY !== y) window.scrollTo(0, y);
  }
  window.addEventListener('resize', () => layoutGrids(false));
  for (const q of ['(min-width: 600px)', '(min-width: 1000px)']) { const mq = window.matchMedia && window.matchMedia(q); if (mq && mq.addEventListener) mq.addEventListener('change', () => layoutGrids(false)); }
  if (window.ResizeObserver) new ResizeObserver(() => layoutGrids(false)).observe(document.documentElement);

  async function showSheet() {
    for (const u of iconCache.values()) if (u) URL.revokeObjectURL(u);
    iconCache.clear();
    buildAbilities(); buildSkills(); buildHitDice(); buildAttacks(); buildLimited(); buildFeats(); buildActions(); buildSlots(); buildProfs(); buildDefense(); buildCoins(); buildMagicItems(); buildGear(); buildMods(); buildConditions(); buildAmmo();
    state.spellOpts = null; state.sheet = null;
    compPrefixes = []; $('#comp-list').textContent = '';
    wsPrefixes = []; $('#ws-list').textContent = '';
    renderCasters(); renderSpellList();
    buildIndex();
    const snaps = await state.worker.call('watch', { names: boundNames() });
    for (const s of snaps) apply(s);
    refreshDerived();
    renderFacts();
    renderLooks();
    renderContent();
    setSaved('saved');
    $('#content-result').hidden = true;
    $('#paste-box').hidden = true;
    $('#start').hidden = true;
    $('#sheet').hidden = false;
    layoutGrids(true);   // after the sheet is visible, so the cards have their heights
    window.scrollTo(0, 0);
    setTab('main');
    refreshSpells();
    state.worker.call('xpInfo', {}).then((x) => { state.xpTable = x.table; refreshDerived(); }).catch(() => {});
    refreshPages();
    state.worker.call('toolNames', {}).then((names) => { const dl = $('#dl-tools'); dl.textContent = ''; for (const n of names) dl.append(el('option', { value: n })); }).catch(() => {});
  }
  wireEvents();
  wireContent();
  wireSpells();
  wireClassAbility();
  wireLooks();
  initStart();
})();
