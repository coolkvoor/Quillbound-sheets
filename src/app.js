/* MPMB Sheet App 0.1 — the screens. All MPMB logic runs in worker.js; this file shows fields and sends taps.
   The screens are split over ui-core.js (shared helpers and state, window.MPMBUI), ui-*.js and this file, loaded in that order. */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const {
    $, $$, el, reduceMotion, state, rows, ABILITIES, SKILLS, BOUND, LEVEL_NAMES, HITDICE, ATTACKS, LIMITED, FEATS,
    ACTIONS, LANGUAGES
  } = U;
  const {
    applyClasses, applyAbilities, showIcon, refreshCompanions, refreshWildShapes, refreshLogs, kb, mpmbDialog,
    spellsSoon, pickPicture, syncCompanions, syncWildShapes, syncLogs, syncNotes, iconCache, renderCasters,
    renderSpellList, renderContent, refreshSpells, wireContent, wireSpells, wireClassAbility, clearPageCards, wireImport
  } = U;
  const APP_BUILD = 'development build';   // tools/build-single.js puts the version and build time here

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
  const SLOW_OPS = { open: 300, parseModel: 300, savePdf: 300, addContent: 300, removeContent: 300, setSources: 300, setUserScript: 300, chooseSpells: 180 };
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

  // ---------------------------------------------------------------- start screen
  const startErr = $('#start-error');
  function showError(msg) { startErr.textContent = msg; startErr.hidden = false; }
  function friendlyError(e) {
    const m = String(e && e.message || e);
    if (/EVAL_BLOCKED/.test(m)) return 'This viewer doesn’t allow the sheet’s scripts to run, so the app can’t start here. Tell Claude: EVAL_BLOCKED.';
    if (/NOT_MPMB/.test(m)) return 'This PDF doesn’t look like an MPMB character sheet. Pick an MPMB character sheet PDF (2024 or 2014).';
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
      state.info = res.info; state.rowCounts = res.rowCounts || null; state.stats = res.stats; state.stats.openMs = Math.round(performance.now() - t0); state.log = res.log;
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
    // MPMB's optional 7th ability, Honor or Sanity (Set Pages Layout → 1st page options → Ability Scores); shown while MPMB shows it
    box.append(el('div', { cls: 'abi', 'data-vis': 'HoS', hidden: '' }, [
      el('span', { cls: 'k up', 'data-out': 'HoSRememberState', text: '' }),
      el('span', { cls: 'mod num', 'data-out': 'HoS Mod', text: '–' }),
      el('input', { 'data-f': 'HoS', id: 'f-abi-HoS', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Honor or Sanity score', cls: 'num' }),
      el('div', { cls: 'save' }, [
        el('button', { cls: 'dot sm', type: 'button', 'data-toggle': 'HoS ST Prof', 'aria-pressed': 'false', 'aria-label': 'Honor or Sanity saving throw proficiency' }),
        el('span', { text: 'Save ' }), el('b', { cls: 'num', 'data-out': 'HoS ST Mod', text: '–' }),
      ]),
      advDis('HoS ST', 'Honor or Sanity save'),
    ]));
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
    for (let i = 1; i <= rows('hd', HITDICE); i++) {
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
    for (let i = 1; i <= rows('attacks', ATTACKS); i++) {
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
    // the Honor / Sanity save bonus, while MPMB shows it
    const hos = modInput('HoS ST Bonus', 'Honor / Sanity');
    hos.dataset.vis = 'HoS ST Bonus';
    hos.hidden = true;
    box.lastChild.querySelector('.mods-grid').append(hos);
    group('Skills', SKILLS.map(([f, name]) => [f + ' Bonus', name]));
  }
  function buildLimited() {
    const box = $('#limited');
    box.textContent = '';
    for (let i = 1; i <= rows('limited', LIMITED); i++) {
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
    for (let i = 1; i <= rows('feats', FEATS); i++) {
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
    for (const [pre, n, label] of ACTIONS) for (let i = 1; i <= rows(pre, n); i++) box.append(el('li', { 'data-row': pre + ' ' + i }, [el('span', { cls: 'grow', 'data-out': pre + ' ' + i }), el('span', { cls: 'chip', text: label }), lineMenu('Button.' + pre + ' ' + i, label + ' ' + i)]));
    box.append(el('li', { cls: 'empty-note muted', text: 'No actions yet.' }));
  }

  // Spell slots: MPMB has 7 boxes per level and uses these for 1–4 slots (SetSpellSlotsCheckboxes). It hides all of
  // them when the sheet's page-1 slot area is switched off, so the app goes by the count, not by what is visible.
  const SLOT_BOXES = ['top1', 'mid', 'bottom1', 'top2.1', 'top2.2', 'bottom2.1', 'bottom2.2'];
  const SLOT_SETS = [[], ['mid'], ['top1', 'bottom1'], ['top2.1', 'top2.2', 'bottom1'], ['top2.1', 'top2.2', 'bottom2.1', 'bottom2.2']];
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
    // tools and languages: MPMB's lines (8 each on Colorful A4, 6 on the other sheets); the filled ones show, plus one empty line to add to (refreshDerived)
    for (const [id, pre, list, label] of [['#tools', 'Tool ', 'dl-tools', 'Tool'], ['#languages', 'Language ', 'dl-languages', 'Language']]) {
      const box = $(id);
      box.textContent = '';
      box.append(el('datalist', { id: list }));
      for (let i = 1; i <= rows(pre.trim(), 8); i++) box.append(el('input', { cls: 'in', 'data-f': pre + i, id: 'f-' + list.slice(3) + i, list, autocomplete: 'off', 'aria-label': label + ' ' + i, placeholder: 'Add ' + label.toLowerCase() }));
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
    for (let i = 1; i <= rows('res', 6); i++) res.append(el('input', { cls: 'in', 'data-f': 'Resistance Damage Type ' + i, id: 'f-res' + i, list: 'dl-res', autocomplete: 'off', 'aria-label': 'Resistance ' + i, placeholder: 'Add resistance' }));
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
  // the 2014 Colorful sheets have them on the 3rd page's Rules section as numbered boxes (MPMB's ConditionSet), with
  // exhaustion as six level boxes; the Printer Friendly sheets have no condition fields, so the card stays hidden there
  const CONDITIONS_2014 = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];
  function buildConditions() {
    const box = $('#conditions');
    box.textContent = '';
    const tg = (field, label) => el('span', { cls: 'tg' }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': field, 'aria-pressed': 'false', 'aria-label': label }), el('span', { text: label })]);
    const new24 = rows('cond24', 1) > 0, old14 = rows('cond14', 14);
    if (new24) for (const c of CONDITIONS) box.append(tg('Condition.' + c, c));
    else for (let i = 1; i <= old14; i++) box.append(tg('Extra.Condition ' + i, CONDITIONS_2014[i - 1] || 'Condition ' + i));
    $('#exh-2024').hidden = !new24;
    const exh = $('#exh-2014-levels');
    exh.textContent = '';
    const levels = new24 ? 0 : rows('exh14', 6);
    for (let i = 1; i <= levels; i++) exh.append(tg('Extra.Exhaustion Level ' + i, String(i)));
    $('#exh-2014').hidden = !levels;
    $('#cond-card').hidden = !new24 && !old14 && !levels;
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

  // Magic items: the first 6 lines on the Additional sheet (page 3); Equipment: every line on pages 2 and 3 (46 and 42
  // on Colorful, 54 and 36 on Printer Friendly; rows() caps it at what the sheet has)
  const MAGIC = 6, GEAR = 99, XGEAR = 99;
  function buildMagicItems() {
    const box = $('#magic-items');
    box.textContent = '';
    for (let i = 1; i <= rows('magic', MAGIC); i++) {
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
      for (let i = 1; i <= rows(key, count); i++) {
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

  // ---------------------------------------------------------------- binding fields to the screen
  function boundNames() {
    const s = new Set();
    for (const n of $$(BOUND.map((a) => '[' + a + ']').join(','))) for (const a of BOUND) if (n.hasAttribute(a)) s.add(n.getAttribute(a));
    for (const [f] of SKILLS.concat([['Too']])) { s.add(f + ' Prof'); s.add(f + ' Exp'); }
    for (let i = 1; i <= rows('hd', HITDICE); i++) { s.add('HD' + i + ' Level'); s.add('HD' + i + ' Die'); s.add('HD' + i + ' Con Mod'); }
    s.add('Extra.Gear Weight Subtotal Left'); s.add('Extra.Gear Weight Subtotal Right');
    s.add('Wildshapes.Info.KnownForms'); s.add('Wildshapes.Info.Uses');   // whether MPMB gave Wild Shape (2024 / 2014 sheets)
    for (let i = 1; i <= rows('Tool', 8); i++) s.add('Tool ' + i);
    for (let i = 1; i <= rows('Language', 8); i++) s.add('Language ' + i);
    for (let l = 1; l <= 9; l++) s.add('SpellSlots.CheckboxesSet.lvl' + l);
    return Array.from(s);
  }
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
    // a field this sheet doesn't have (the sheet types and versions differ: 2014 sheets have no known forms on the
    // Wild Shapes page, Printer Friendly no hit points per shape): its box and label are left out
    for (const a of ['data-f', 'data-out', 'data-rich', 'data-toggle', 'data-opts']) for (const n of sel(a)) absent(n, !snap.exists);
    for (const n of sel('data-items')) {
      n.textContent = '';
      for (const it of snap.items || []) if (it[0]) n.append(el('option', { value: it[0] }));
    }
  }
  function absent(n, gone) {
    const w = n.closest('.f, .tg, .stat, .ad-wrap') || n;   // .ad-wrap: a label with its Adv / Dis boxes (none on Printer Friendly)
    if (gone) { if (!w.hidden) { w.hidden = true; w.dataset.absent = '1'; } } else if (w.dataset.absent) { w.hidden = false; delete w.dataset.absent; }
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
    clearPageCards();
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
  // what the other screen files use from here
  Object.assign(U, {
    send, lineMenu, modInput, buildIndex, apply, layoutGrids, refreshDerived, showNotice, toast, shown,
    inlineMarkup, goTo, setBusy, idbPut, saveSoon, fmtS, openSheet, askYesNo, stopAutosave: () => { clearTimeout(saveTimer); saveTimer = 0; }
  });
  wireEvents();
  wireContent();
  wireImport();
  wireSpells();
  wireClassAbility();
  wireLooks();
  initStart();
})();
