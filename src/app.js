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
  async function idbDel(key) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { /* storage may be unavailable */ } }
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
    state.charKey = 'char:' + name + '|' + buf.byteLength;       // and so does the autosaved character
    const stored = await idbGet(state.sheetKey);
    const char = await idbGet(state.charKey);
    state.savedAt = char && char.date ? char.date : 0;
    let w = null;
    const t0 = performance.now();
    try {
      w = connect();
      state.worker = w;
      w.onProgress = (t) => { $('#loading-text').textContent = t; };
      const res = await w.call('open', { bytes: buf, fileName: name, saved: stored && stored.saved ? stored.saved : null, state: char && char.state ? char.state : null }, [buf]);
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
  function renderFeatures(node, snap) {
    const raw = snap && snap.exists ? String(snap.value || '') : '';
    node.textContent = '';
    if (!raw.trim()) return;
    const lines = raw.replace(/\r\n?|\n/g, '\n').split('\n');
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const key = node.dataset.features + '|' + cur.name;
      const d = el('details', { cls: 'feat' });
      d.open = openFeatures.has(key);
      d.addEventListener('toggle', () => { if (d.open) openFeatures.add(key); else openFeatures.delete(key); });
      const sum = el('summary', {}, [el('span', { cls: 'fname', text: cur.name })]);
      if (cur.usage) sum.append(el('span', { cls: 'chip use', text: cur.usage }));
      if (cur.src) sum.append(el('span', { cls: 'fsrc', text: cur.src }));
      d.append(sum);
      const body = el('div', { cls: 'fbody' });
      for (const t of cur.text) { const p = el('p'); inlineMarkup(t, p); body.append(p); }
      if (!cur.text.length) body.append(el('p', { cls: 'muted', text: 'No description.' }));
      d.append(body);
      node.append(d);
      cur = null;
    };
    // Text saved before the line-break fix: every description piled under the last feature of a class, the others
    // empty. Spot it (2+ empty features, and the last one holding more lines than there are empty ones) and offer a rebuild.
    // Also after levelling up such a character: MPMB rewrites features whose text changes, but leaves others (Ritual
    // Adept) without their text. So: a normal feature heading with no description at all means old text. A choice line
    // such as "#◆ Scholar: Arcana# (Wizard 2, SRD'24 78) [Expertise in Arcana]" has no description by design.
    if (node.dataset.features === 'class') {
      const NORMAL = /^#\s*◆\s*[^#]+#\s*(?:\([^)]*\))?\s*(?:#\[.*\]#)?\s*$/;
      let stale = false, open = null;
      for (const line of lines.concat(['#◆ end#'])) {
        if (/^#\s*◆/.test(line) || /^\*\*/.test(line)) { if (open && open.normal && !open.text) stale = true; open = /^#\s*◆/.test(line) ? { normal: NORMAL.test(line), text: 0 } : null; }
        else if (open && line.trim()) open.text++;
      }
      const note = $('#cf-stale'); if (note) note.hidden = !stale;
    }
    for (const line of lines) {
      let m;
      if (!line.trim()) continue;
      if ((m = /^\*\*(.+?):?\*\*\s*$/.exec(line))) { flush(); node.append(el('div', { cls: 'fgroup', text: m[1] })); continue; }
      // the usage in brackets comes as #[…]# normally, and as plain […] after a feature choice ("Scholar: Arcana")
      if ((m = /^#\s*◆\s*(.+?)#\s*(?:\(([^)]*)\))?\s*(?:#?\[(.*)\]#?)?\s*$/.exec(line))) { flush(); cur = { name: m[1].trim(), src: (m[2] || '').trim(), usage: (m[3] || '').trim(), text: [] }; continue; }
      if ((m = /^##\s*◆\s*(.+?)##\.?\s*(.*)$/.exec(line))) { flush(); cur = { name: m[1].trim(), src: '', usage: '', text: m[2] ? [m[2]] : [] }; continue; }
      if (cur) cur.text.push(line); else { const p = el('p', { cls: 'fpara' }); inlineMarkup(line, p); node.append(p); }
    }
    flush();
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
    // skills: proficiency / expertise dots
    for (const b of $$('[data-skill]')) {
      const f = b.dataset.skill;
      const prof = (state.snap.get(f + ' Prof') || {}).checked, exp = (state.snap.get(f + ' Exp') || {}).checked;
      b.setAttribute('aria-pressed', prof || exp ? 'true' : 'false');
      b.classList.toggle('exp', !!exp);
      b.setAttribute('aria-label', b.parentElement.querySelector('.n').textContent + (exp ? ' expertise' : prof ? ' proficiency' : ' not proficient'));
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

  // ---------------------------------------------------------------- autosave: the character stays on this device
  let saveTimer = 0, saving = false, saveAgain = false;
  function saveSoon() { clearTimeout(saveTimer); setSaved('pending'); saveTimer = setTimeout(saveNow, 700); }
  async function saveNow() {
    saveTimer = 0;
    if (!state.worker || !state.charKey) return;
    if (saving) { saveAgain = true; return; }
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
  async function send(op, args) {
    setBusy(1);
    try {
      const res = await state.worker.call(op, args);
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
      const n = e.target.closest && e.target.closest('[data-f]');
      if (!n || !state.worker) return;
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
    $('#run-test').addEventListener('click', runSelfTest);
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
        const ret = await pickFromMenu(res.menu, title, name === 'Class Features Menu' || name === 'Race Features Menu');
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
  function casterKind(c) { return c.spells && c.spells.book ? 'book' : c.prepared ? 'list' : c.spells ? 'known' : 'none'; }
  function openPicker(key) {
    const o = state.spellOpts;
    picker.picks = {};
    for (const c of o.casters) picker.picks[c.key] = { cantrips: new Set(c.cantrips ? c.cantrips.chosen : []), spells: new Set(c.spells ? c.spells.chosen : []), prepared: new Set(c.prepared ? c.prepared.chosen : []) };
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
    const notes = { book: 'Add spells to your spellbook, then prepare the ones you want today.', list: 'Prepare the spells you want today from your class list.', known: 'Choose the spells you know.', none: 'There is nothing to choose here: MPMB adds these spells itself.' };
    $('#picker-note').textContent = notes[kind] + (c.maxLevel ? ' You can cast spells up to ' + LEVEL_NAMES[c.maxLevel].toLowerCase() + '.' : '');
    const q = picker.search.trim().toLowerCase();
    const info = state.spellOpts.spells;
    const ul = $('#picker-list');
    const body = $('#picker-body');
    const keep = body.scrollTop;
    ul.textContent = '';
    let level = null;
    const full = (id) => lim[id] && lim[id].max && lim[id].n >= lim[id].max;
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
    $('#picker-bar').hidden = kind === 'none';
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
    for (const k in picker.picks) { const p = picker.picks[k]; picks[k] = { cantrips: Array.from(p.cantrips), spells: Array.from(p.spells), prepared: Array.from(p.prepared) }; }
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
  const fmtS =(ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms');
  function renderFacts() {
    const i = state.info, s = state.stats;
    $('#sheet-ver').textContent = 'MPMB v' + i.version + ' · ' + i.type;
    const dl = $('#sheet-facts');
    dl.textContent = '';
    const add = (k, v) => { dl.append(el('dt', { text: k }), el('dd', { text: v })); };
    add('App', APP_BUILD);
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
  // Cards go into fixed columns, each into the shortest column so far, in reading order. They only move when the
  // number of columns changes (rotating, resizing), never because a card's content grows or folds.
  let gridCols = 0;
  const colCount = () => (window.innerWidth >= 1000 ? 3 : window.innerWidth >= 600 ? 2 : 1);
  function layoutGrids(force) {
    const n = colCount();
    if (n === gridCols && !force) return;
    gridCols = n;
    for (const grid of $$('.grid')) {
      if (!grid._cards) grid._cards = Array.from(grid.children).filter((c) => c.classList.contains('card'));
      const cols = [];
      for (let i = 0; i < n; i++) cols.push(el('div', { cls: 'gcol' }));
      grid.textContent = '';
      for (const c of cols) grid.append(c);
      for (const card of grid._cards) {
        let best = cols[0];
        for (const c of cols) if (c.offsetHeight < best.offsetHeight) best = c;
        best.append(card);
      }
    }
  }
  window.addEventListener('resize', () => layoutGrids(false));
  for (const q of ['(min-width: 600px)', '(min-width: 1000px)']) { const mq = window.matchMedia && window.matchMedia(q); if (mq && mq.addEventListener) mq.addEventListener('change', () => layoutGrids(false)); }
  if (window.ResizeObserver) new ResizeObserver(() => layoutGrids(false)).observe(document.documentElement);

  async function showSheet() {
    buildAbilities(); buildSkills(); buildHitDice(); buildAttacks(); buildLimited(); buildFeats(); buildActions(); buildSlots(); buildProfs(); buildCoins(); buildMagicItems(); buildGear(); buildMods(); buildConditions(); buildAmmo();
    state.spellOpts = null; state.sheet = null;
    renderCasters(); renderSpellList();
    buildIndex();
    const snaps = await state.worker.call('watch', { names: boundNames() });
    for (const s of snaps) apply(s);
    refreshDerived();
    renderFacts();
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
  }
  wireEvents();
  wireContent();
  wireSpells();
  wireClassAbility();
  initStart();
})();
