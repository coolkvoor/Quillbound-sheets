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
  function connect() {
    const w = newWorker();
    const pending = new Map();
    let seq = 0;
    const api = {
      onProgress: null,
      call(op, args, transfer) {
        const id = ++seq;
        return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, op, args }, transfer || []); });
      },
      terminate() { w.terminate(); for (const p of pending.values()) p.reject(new Error('stopped')); pending.clear(); },
    };
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'progress') { if (api.onProgress) api.onProgress(m.text); return; }
      if (m.type === 'ready') return;
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    };
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
  async function idbPut(key, val) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { /* storage may be unavailable */ } }

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
    state.snap.clear();
    state.bytes = buf.slice(0);
    state.fileName = name;
    state.sheetKey = 'content:' + name + '|' + buf.byteLength;   // add-on content belongs to this sheet file
    const stored = await idbGet(state.sheetKey);
    let w = null;
    const t0 = performance.now();
    try {
      w = connect();
      state.worker = w;
      w.onProgress = (t) => { $('#loading-text').textContent = t; };
      const res = await w.call('open', { bytes: buf, fileName: name, saved: stored && stored.saved ? stored.saved : null }, [buf]);
      state.info = res.info; state.stats = res.stats; state.stats.openMs = Math.round(performance.now() - t0); state.log = res.log;
      state.content = res.content; state.saved = res.saved;
      // MPMB drops an add-on that fails at startup; keep what it kept
      if (stored && stored.saved && JSON.stringify(stored.saved) !== JSON.stringify(res.saved)) idbPut(state.sheetKey, { saved: res.saved, date: Date.now() });
      if (remember) idbPut('last', { name, blob: new Blob([state.bytes], { type: 'application/pdf' }), date: Date.now() });
      await showSheet();
    } catch (e) {
      if (w) w.terminate();
      state.worker = null;
      loading.hidden = true; $('#start-actions').hidden = false;
      showError(friendlyError(e));
    }
  }

  // ---------------------------------------------------------------- building the screens
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
        el('span', { cls: 'v num', 'data-out': f, text: '–' }),
      ]));
    }
  }
  function buildHitDice() {
    const box = $('#hitdice');
    box.textContent = '';
    for (let i = 1; i <= HITDICE; i++) {
      box.append(el('div', { cls: 'hd', 'data-row': 'HD' + i + ' Level' }, [
        el('span', { 'data-hd': String(i), text: 'Hit dice' }),
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
        // MPMB's modifier ("blue text") fields for this attack, shown when MPMB shows them
        el('div', { cls: 'row atk-mods', 'data-vis': 'BlueText.' + p + 'To Hit Bonus', hidden: '' }, [
          modInput('BlueText.' + p + 'To Hit Bonus', 'To hit +'),
          modInput('BlueText.' + p + 'Damage Bonus', 'Damage +'),
        ]),
      ]));
    }
  }
  const modInput = (field, label) => el('label', { cls: 'f mod' }, [el('span', { text: label }), el('input', { cls: 'in num', 'data-f': field, id: 'f-mod-' + field.replace(/\W+/g, '-'), autocomplete: 'off', inputmode: 'text' })]);
  function buildMods() {
    const box = $('#mods');
    box.textContent = '';
    const group = (title, items) => box.append(el('div', { cls: 'mods-group' }, [el('span', { cls: 'lbl', text: title }), el('div', { cls: 'mods-grid' }, items.map(([f, l]) => modInput(f, l)))]));
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
  }
  function buildCoins() {
    const box = $('#coins');
    box.textContent = '';
    for (const [f, k, long] of [['Copper Pieces', 'cp', 'Copper'], ['Silver Pieces', 'sp', 'Silver'], ['Electrum Pieces', 'ep', 'Electrum'], ['Gold Pieces', 'gp', 'Gold'], ['Platinum Pieces', 'pp', 'Platinum']]) {
      box.append(el('label', {}, [el('span', { text: k }), el('input', { cls: 'in num', 'data-f': f, id: 'f-coin-' + k, inputmode: 'numeric', autocomplete: 'off', 'aria-label': long + ' pieces' })]));
    }
  }

  // Magic items: the 6 lines on the Additional sheet (page 3); Equipment: the 46 lines on page 2
  const MAGIC = 6, GEAR = 46;
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
  function buildGear() {
    const box = $('#gear-list');
    box.textContent = '';
    box.append(el('div', { cls: 'gear-head' }, [el('span', { text: 'Item' }), el('span', { text: 'Amount' }), el('span', { text: 'Weight' }), el('span')]));
    for (let i = 1; i <= GEAR; i++) {
      const p = 'Adventuring Gear ';
      box.append(el('div', { cls: 'gear-row', 'data-gear': String(i) }, [
        el('input', { cls: 'in', 'data-f': p + 'Row ' + i, id: 'f-gear' + i, autocomplete: 'off', placeholder: 'Add an item', 'aria-label': 'Item ' + i }),
        el('input', { cls: 'in num', 'data-f': p + 'Amount ' + i, id: 'f-gearn' + i, inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Amount' }),
        el('input', { cls: 'in num', 'data-f': p + 'Weight ' + i, id: 'f-gearw' + i, inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Weight' }),
        lineMenu('Adventuring Gear Button ' + i, 'Item ' + i),
      ]));
    }
  }

  // ---------------------------------------------------------------- binding fields to the screen
  function boundNames() {
    const s = new Set();
    for (const n of $$(BOUND.map((a) => '[' + a + ']').join(','))) for (const a of BOUND) if (n.hasAttribute(a)) s.add(n.getAttribute(a));
    for (const [f] of SKILLS) { s.add(f + ' Prof'); s.add(f + ' Exp'); }
    for (let i = 1; i <= HITDICE; i++) { s.add('HD' + i + ' Level'); s.add('HD' + i + ' Die'); }
    for (let i = 1; i <= 8; i++) { s.add('Tool ' + i); s.add('Language ' + i); }
    for (let l = 1; l <= 9; l++) s.add('SpellSlots.CheckboxesSet.lvl' + l);
    return Array.from(s);
  }
  // the attributes that bind an element to an MPMB field (data-mpmb: one of MPMB's buttons, shown when MPMB shows it)
  // data-vis: shown only while MPMB shows that field (its modifier fields, for example)
  const BOUND = ['data-f', 'data-out', 'data-rich', 'data-toggle', 'data-items', 'data-mpmb', 'data-vis'];
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
    const ix = (index && index.get(snap.name)) || {};
    const sel = (attr) => ix[attr] || [];
    for (const n of sel('data-f')) { if (document.activeElement !== n) n.value = snap.exists ? (Array.isArray(snap.value) ? snap.value.join(', ') : snap.value) : ''; n.readOnly = !!snap.readonly; }
    for (const n of sel('data-out')) { const t = shown(snap); n.textContent = t === '' && n.classList.contains('v') ? '–' : t; }
    for (const n of sel('data-rich')) renderRich(n, snap);
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
    // skills: proficiency / expertise dots
    for (const b of $$('[data-skill]')) {
      const f = b.dataset.skill;
      const prof = (state.snap.get(f + ' Prof') || {}).checked, exp = (state.snap.get(f + ' Exp') || {}).checked;
      b.setAttribute('aria-pressed', prof || exp ? 'true' : 'false');
      b.classList.toggle('exp', !!exp);
      b.setAttribute('aria-label', b.parentElement.querySelector('.n').textContent + (exp ? ' expertise' : prof ? ' proficiency' : ' not proficient'));
    }
    // rows that only show when MPMB filled them
    // magic items and gear: filled lines plus the first empty one
    const showFilled = (sel, field, extra) => {
      let first = true;
      for (const row of $$(sel)) {
        const i = row.dataset.mi || row.dataset.gear;
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
    // feats: filled lines plus the first empty one, to pick a new feat
    let featEmpty = true;
    for (const li of $$('[data-feat]')) {
      const has = v('Feat Name ' + li.dataset.feat) !== '' || li.contains(document.activeElement);
      li.hidden = !has && !featEmpty;
      li.querySelector('.more').hidden = !has;
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
      row.querySelector('[data-figs]').hidden = !has;
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
    // tools and languages
    for (const [id, pre, empty] of [['#tools', 'Tool ', 'None yet'], ['#languages', 'Language ', 'None yet']]) {
      const ul = $(id); if (!ul) continue;
      ul.textContent = '';
      for (let i = 1; i <= 8; i++) { const t = v(pre + i); if (t) ul.append(el('li', { text: t })); }
      if (!ul.children.length) ul.append(el('li', { cls: 'none', text: empty }));
    }
    renderLog();
  }

  // ---------------------------------------------------------------- talking to MPMB
  function setBusy(d) { state.busy += d; $('#busy').classList.toggle('on', state.busy > 0); }
  async function send(op, args) {
    setBusy(1);
    try {
      const res = await state.worker.call(op, args);
      for (const s of res.changes || []) apply(s);
      if (res.log) state.log = res.log;
      refreshDerived();
      if (op !== 'chooseSpells' && op !== 'removeSpells') spellsSoon();   // class, level, feats and so on change the spell choices
      return res;
    } catch (e) {
      state.log = state.log || { errors: [] };
      state.log.errors.push({ where: 'app', msg: String(e.message || e) });
      renderLog();
    } finally { setBusy(-1); }
  }
  function wireEvents() {
    document.addEventListener('change', (e) => {
      const n = e.target.closest && e.target.closest('[data-f]');
      if (!n || !state.worker) return;
      send('commit', { name: n.dataset.f, value: n.value });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches && e.target.matches('input[data-f]')) { e.preventDefault(); e.target.blur(); }
    });
    document.addEventListener('click', async (e) => {
      const t = e.target.closest && e.target.closest('[data-toggle],[data-skill],[data-tab],[data-goto],[data-mpmb],[data-bookmark]');
      if (!t) return;
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
    $('#run-test').addEventListener('click', runSelfTest);
    $('#open-other').addEventListener('click', () => { $('#sheet').hidden = true; $('#start').hidden = false; $('#loading').hidden = true; $('#start-actions').hidden = false; initStart(); });
  }

  // ---------------------------------------------------------------- tabs that follow the scroll
  const BANDS = ['main', 'combat', 'spells', 'features', 'gear', 'sheetinfo'];
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
    for (const id of BANDS) { const b = document.getElementById(id); if (b && b.getBoundingClientRect().top <= line) cur = id; }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = BANDS[BANDS.length - 1];
    setTab(cur);
  }
  let spyQueued = false;
  window.addEventListener('scroll', () => { if (spyQueued) return; spyQueued = true; requestAnimationFrame(() => { spyQueued = false; spy(); }); }, { passive: true });

  // ---------------------------------------------------------------- MPMB's menus, buttons and messages
  // A menu item's name can carry its source after a tab: "High Elf\t   [SRD'24 85]"
  const splitName = (n) => { const p = String(n).split(/\t+/); return [p[0].trim(), p.slice(1).join(' ').trim()]; };
  function pickFromMenu(items, title) {
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
      };
      $('#menu-back').onclick = () => { stack.pop(); render(); };
      $('#menu-close').onclick = () => finish(null);
      dlg.onclose = () => finish(null);
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
  let toastTimer = 0;
  function toast(text) {
    let t = $('#toast');
    if (!t) { t = el('div', { id: 'toast', cls: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  // A tap on one of MPMB's buttons: run it; if it opens a menu, ask, then run it again with the choice
  // data-mpmb: the button's field name; data-bookmark: a bookmark path ("Functions/Spells Options"); data-modifier: Ctrl-click
  async function tapMpmb(btn) {
    const name = btn.dataset.mpmb, title = btn.dataset.title || btn.textContent.trim();
    const where = btn.dataset.bookmark ? { bookmark: btn.dataset.bookmark.split('/') } : { name, modifier: btn.dataset.modifier === '1' };
    const answers = [];
    for (let i = 0; i < 6; i++) {
      const res = await send('tap', Object.assign({ answers }, where));
      if (!res) return;
      if (res.menu) {
        const ret = await pickFromMenu(res.menu, title);
        if (ret === null) return;
        answers.push(ret);
        continue;
      }
      if (res.alerts && res.alerts.length) await showNotice(res.alerts);
      else if (btn.dataset.done) toast(btn.dataset.done);
      return;
    }
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
    if (!rows.length) { box.append(el('p', { cls: 'note', text: s && s.pages ? 'The spell list is empty.' : 'Choose spells, then make the spell list. MPMB fills in each spell’s details.' })); return; }
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
    for (const p of String(d.text).replace(/\r\n?/g, '\n').split(/\n+/)) if (p.trim()) body.append(el('p', { cls: 'notice-msg', text: p.trim() }));
  }

  // the spell picker: one caster at a time, a tab per part (cantrips, spellbook or spells known, prepared)
  const picker = { caster: null, part: null, picks: null };
  function openPicker(key) {
    const o = state.spellOpts;
    picker.picks = {};
    for (const c of o.casters) picker.picks[c.key] = { cantrips: new Set(c.cantrips ? c.cantrips.chosen : []), spells: new Set(c.spells ? c.spells.chosen : []), prepared: new Set(c.prepared ? c.prepared.chosen : []), show: c.show ? c.show.value : undefined };
    picker.caster = o.casters.filter((c) => c.key === key)[0];
    const c = picker.caster;
    picker.part = c.cantrips ? 'cantrips' : c.spells ? 'spells' : 'prepared';
    if (!pickerParts(c).length) picker.part = 'none';
    $('#picker-title').textContent = (c.name || c.key) + ': choose spells';
    $('#picker-search').value = '';
    renderPicker();
    $('#picker').showModal();
  }
  function pickerParts(c) {
    const parts = [];
    if (c.cantrips) parts.push(['cantrips', 'Cantrips']);
    if (c.spells) parts.push(['spells', c.spells.book ? 'Spellbook' : 'Spells known']);
    // MPMB only uses these picks for "Prepared spells only"; the other lists get a prepared box per spell
    if (c.prepared && (c.prepared.count || c.prepared.fromBook) && Number(picker.picks[c.key].show) === 3) parts.push(['prepared', 'Prepared']);
    return parts;
  }
  function pickerItems(c, part) {
    const info = state.spellOpts.spells;
    const lvl = (k) => (info[k] ? info[k].level : 0);
    if (part === 'none') return { list: [], limit: 0 };
    if (part === 'cantrips') return { list: c.cantrips.list, limit: c.cantrips.count };
    if (part === 'spells') return { list: c.spells.list, limit: c.spells.book ? 0 : c.spells.count };
    // prepared: a spellbook caster prepares from the spellbook (up to the highest level it can cast)
    const p = picker.picks[c.key];
    const list = c.prepared.fromBook
      ? Array.from(p.spells).filter((k) => lvl(k) >= 1 && (!c.maxLevel || lvl(k) <= c.maxLevel)).sort((a, b) => lvl(a) - lvl(b) || a.localeCompare(b)).map((k) => ({ key: k, name: info[k] ? info[k].name : k }))
      : c.prepared.list;
    return { list, limit: c.prepared.count };
  }
  function renderPicker() {
    const c = picker.caster, p = picker.picks[c.key];
    const parts = pickerParts(c);
    if (parts.length && !parts.some((x) => x[0] === picker.part)) picker.part = parts[0][0];
    if (!parts.length) picker.part = 'none';
    const tabs = $('#picker-tabs');
    tabs.textContent = '';
    tabs.hidden = !parts.length;
    for (const [id, label] of parts) {
      const set = p[id];
      const t = el('button', { type: 'button', role: 'tab', 'aria-selected': id === picker.part ? 'true' : 'false', text: label + ' (' + set.size + ')' });
      t.addEventListener('click', () => { picker.part = id; renderPicker(); });
      tabs.append(t);
    }
    const { list, limit } = pickerItems(c, picker.part);
    const set = p[picker.part] || new Set();
    const q = $('#picker-search').value.trim().toLowerCase();
    const info = state.spellOpts.spells;
    $('#picker-count').textContent = limit ? set.size + ' of ' + limit : set.size + ' chosen';
    $('#picker-note').textContent = picker.part === 'none' ? 'There is nothing to choose here: MPMB adds these spells itself.' : picker.part === 'prepared' && c.prepared.fromBook && !list.length ? 'Add spells to the spellbook first; you prepare spells from it.'
      : limit ? 'Choose up to ' + limit + '.' : picker.part === 'spells' && c.spells.book ? 'Add every spell in your spellbook.' : '';
    const ul = $('#picker-list');
    ul.textContent = '';
    let level = null;
    const full = limit && set.size >= limit;
    for (const s of list) {
      const d = info[s.key] || {};
      if (q && s.name.toLowerCase().indexOf(q) === -1) continue;
      if (picker.part !== 'cantrips' && d.level !== level) { level = d.level; ul.append(el('li', { cls: 'lv', text: LEVEL_NAMES[level] || 'Other' })); }
      const cb = el('input', { type: 'checkbox', 'data-key': s.key });
      cb.checked = set.has(s.key);
      cb.disabled = !cb.checked && full;
      const label = el('label', { cls: cb.disabled ? 'off' : '' }, [cb, el('span', { text: s.name }), el('span', { cls: 'meta', text: [d.school, d.time, d.range, d.source].filter(Boolean).join(' · ') })]);
      ul.append(el('li', {}, [label]));
    }
    if (!ul.children.length && picker.part !== 'none') ul.append(el('li', { cls: 'note', text: q ? 'No spells match “' + q + '”.' : 'Nothing to choose here.' }));
    $('#picker-search').parentElement.hidden = picker.part === 'none';
    // what the spell list shows (MPMB's radio buttons)
    const show = $('#picker-show');
    show.hidden = !c.show || picker.part === 'cantrips';
    if (c.show) {
      const box = $('#picker-show-opts');
      box.textContent = '';
      for (const ch of c.show.choices) {
        const r = el('input', { type: 'radio', name: 'picker-show', value: String(ch.value) });
        r.checked = Number(p.show) === ch.value;
        r.addEventListener('change', () => { p.show = ch.value; if (picker.part === 'prepared' && ch.value !== 3) picker.part = 'spells'; renderPicker(); });
        box.append(el('label', {}, [r, el('span', { text: ch.name })]));
      }
    }
  }
  function wireSpells() {
    $('#picker-list').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-key]');
      if (!cb) return;
      const p = picker.picks[picker.caster.key], set = p[picker.part];
      if (cb.checked) set.add(cb.dataset.key); else { set.delete(cb.dataset.key); if (picker.part === 'spells') p.prepared.delete(cb.dataset.key); }
      const keep = $('#picker-list').scrollTop;
      renderPicker();
      $('#picker-list').scrollTop = keep;
    });
    $('#picker-search').addEventListener('input', () => renderPicker());
    $('#picker-close').addEventListener('click', () => $('#picker').close());
    $('#picker-save').addEventListener('click', async () => {
      const picks = {};
      for (const k in picker.picks) { const p = picker.picks[k]; picks[k] = { cantrips: Array.from(p.cantrips), spells: Array.from(p.spells), prepared: Array.from(p.prepared), show: p.show }; }
      $('#picker').close();
      await makeSpellList(picks);
    });
    $('#spells-update').addEventListener('click', () => makeSpellList(null));
    $('#spells-remove').addEventListener('click', async () => {
      const res = await send('removeSpells', {});
      if (res) { state.sheet = res.sheet; renderSpellList(); toast('Spell list removed.'); }
    });
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
    renderContent(); refreshDerived(); spellsSoon();
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
  const fmtS =(ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms');
  function renderFacts() {
    const i = state.info, s = state.stats;
    $('#sheet-ver').textContent = 'MPMB v' + i.version + ' · ' + i.type;
    const dl = $('#sheet-facts');
    dl.textContent = '';
    const add = (k, v) => { dl.append(el('dt', { text: k }), el('dd', { text: v })); };
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
  async function runSelfTest() {
    const btn = $('#run-test'), out = $('#test-out');
    btn.disabled = true;
    out.textContent = '';
    out.append(el('p', { cls: 'note', text: 'Opening a fresh copy of the sheet…' }));
    const w = connect();
    try {
      const t0 = performance.now();
      const opened = await w.call('open', { bytes: state.bytes.slice(0), fileName: state.fileName });
      const openMs = Math.round(performance.now() - t0);
      out.firstChild.textContent = 'Building the test character…';
      const res = await w.call('selftest', {});
      const passed = res.results.filter((r) => r.ok).length;
      out.textContent = '';
      const cls = res.timings.filter((x) => /^Class and Levels/.test(x.step))[0];
      out.append(el('p', { cls: passed === res.results.length ? 'pass' : 'fail', text: passed + ' of ' + res.results.length + ' checks passed' }));
      out.append(el('p', { cls: 'note', text: 'Opening ' + fmtS(openMs) + ' (reading ' + fmtS(opened.stats.loadMs) + ', starting MPMB ' + fmtS(opened.stats.startMs) + ') · choosing the class ' + fmtS(cls ? cls.ms : 0) + ' · all steps ' + fmtS(res.timings.reduce((a, b) => a + b.ms, 0)) }));
      const list = el('div', { cls: 'results' });
      for (const r of res.results) list.append(el('div', { cls: 'res' }, [el('span', { cls: 'lab', text: r.label }), el('span', { cls: r.ok ? 'pass' : 'fail', text: r.ok ? 'Pass' : 'Fail' }), el('span', { cls: 'val num', text: (r.value || '(empty)').replace(/[\r\n]+/g, ' ') + (r.ok ? '' : ' (expected ' + r.expected + ')') })]));
      out.append(list);
      if (res.errors.length) out.append(el('p', { cls: 'fail', text: res.errors.length + ' script errors: ' + res.errors.map((e) => e.where + ': ' + e.msg).join(' | ') }));
      const report = ['MPMB Sheet App 0.1 self-test', passed + '/' + res.results.length + ' passed', 'Screen ' + window.innerWidth + 'x' + window.innerHeight + ' @' + Math.round((window.devicePixelRatio || 1) * 100) / 100, 'Open ' + openMs + 'ms (read ' + opened.stats.loadMs + 'ms, start ' + opened.stats.startMs + 'ms), class ' + (cls ? cls.ms : 0) + 'ms', navigator.userAgent]
        .concat(res.results.filter((r) => !r.ok).map((r) => 'FAIL ' + r.label + ': ' + r.value)).concat(res.errors.map((e) => 'ERR ' + e.where + ': ' + e.msg)).join('\n');
      const copy = el('button', { cls: 'btn', type: 'button', text: 'Copy results' });
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(report); copy.textContent = 'Copied'; } catch (e) { const ta = el('textarea', { cls: 'in', rows: '6' }); ta.value = report; copy.replaceWith(ta); ta.select(); } });
      out.append(copy);
    } catch (e) {
      out.textContent = '';
      out.append(el('p', { cls: 'fail', text: friendlyError(e) }));
    } finally { w.terminate(); btn.disabled = false; }
  }

  // ---------------------------------------------------------------- go
  async function showSheet() {
    buildAbilities(); buildSkills(); buildHitDice(); buildAttacks(); buildLimited(); buildFeats(); buildActions(); buildSlots(); buildProfs(); buildCoins(); buildMagicItems(); buildGear(); buildMods();
    state.spellOpts = null; state.sheet = null;
    renderCasters(); renderSpellList();
    buildIndex();
    const snaps = await state.worker.call('watch', { names: boundNames() });
    for (const s of snaps) apply(s);
    refreshDerived();
    renderFacts();
    renderContent();
    $('#content-result').hidden = true;
    $('#paste-box').hidden = true;
    $('#start').hidden = true;
    $('#sheet').hidden = false;
    window.scrollTo(0, 0);
    setTab('main');
    refreshSpells();
  }
  wireEvents();
  wireContent();
  wireSpells();
  initStart();
})();
