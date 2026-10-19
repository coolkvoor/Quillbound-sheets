/* MPMB Sheet App — the class and ability score screens (MPMB's Class Selection and Ability Scores dialogs). Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, $$, el, state } = U;
  // from the other screen files (all loaded before anything runs)
  const showNotice = (...a) => U.showNotice(...a);
  const send = (...a) => U.send(...a);
  const toast = (...a) => U.toast(...a);

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

  Object.assign(U, {
    applyClasses, applyAbilities, wireClassAbility
  });
})();
