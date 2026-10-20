/* Quillbound Sheets — the Spells tab: spell lists and the spell picker. Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, el, state, LEVEL_NAMES } = U;
  // from the other screen files (all loaded before anything runs)
  const send = (...a) => U.send(...a);
  const shown = (...a) => U.shown(...a);
  const inlineMarkup = (...a) => U.inlineMarkup(...a);
  const toast = (...a) => U.toast(...a);
  const showNotice = (...a) => U.showNotice(...a);
  const goTo = (...a) => U.goTo(...a);

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

  Object.assign(U, {
    spellsSoon, renderCasters, renderSpellList, refreshSpells, wireSpells
  });
})();
