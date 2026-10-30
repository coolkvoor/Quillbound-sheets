/* Quillbound Sheets — add-on content and sources. Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, $$, el, state } = U;
  // from the other screen files (all loaded before anything runs)
  const setBusy = (...a) => U.setBusy(...a);
  const apply = (...a) => U.apply(...a);
  const idbPut = (...a) => U.idbPut(...a);
  const refreshDerived = (...a) => U.refreshDerived(...a);
  const spellsSoon = (...a) => U.spellsSoon(...a);
  const saveSoon = (...a) => U.saveSoon(...a);
  const fmtS = (...a) => U.fmtS(...a);

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
    // books, grouped like MPMB's Source Selection dialog: one fold per group (Primary Sources first, then as MPMB lists
    // them), books by the name its dialog shows (Unearthed Arcana by date). A tick waiting to be applied shows as ticked.
    const box = $('#source-list');
    box.textContent = '';
    const off = (s) => (want ? want.has(s.key) : s.excluded);
    const groups = [];
    for (const s of c.sources) {
      let g = groups.filter((x) => x.name === s.group)[0];
      if (!g) groups.push(g = { name: s.group, books: [] });
      g.books.push(s);
    }
    groups.sort((x, y) => (/primary|core/i.test(y.name) ? 1 : 0) - (/primary|core/i.test(x.name) ? 1 : 0));
    const many = c.sources.length > 12;
    for (const g of groups) {
      g.books.sort((x, y) => x.dialogName.localeCompare(y.dialogName));
      const on = g.books.filter((s) => !off(s)).length;
      const fold = el('details', { cls: 'src-fold', 'data-group': g.name });
      fold.open = !many || openGroups.has(g.name);
      // remember the user's own taps only (a fold opened because the list was short isn't one)
      const sum = el('summary', {}, [el('span', { cls: 'src-group', text: g.name }), el('span', { cls: 'src-count', text: on + ' of ' + g.books.length + ' in use' })]);
      sum.addEventListener('click', () => { if (fold.open) openGroups.delete(g.name); else openGroups.add(g.name); });
      fold.append(sum);
      if (g.books.length > 1) {
        fold.append(el('div', { cls: 'row src-all' }, [
          el('button', { cls: 'btn sm', type: 'button', 'data-src-group': g.name, 'data-src-to': 'on', text: 'Include these' }),
          el('button', { cls: 'btn sm', type: 'button', 'data-src-group': g.name, 'data-src-to': 'off', text: 'Exclude these' }),
        ]));
      }
      for (const s of g.books) {
        const cb = el('input', { type: 'checkbox', 'data-source': s.key });
        cb.checked = !off(s);
        const counts = countText(s.counts);
        fold.append(el('label', { cls: 'src' + (off(s) ? ' off' : '') }, [
          cb,
          el('span', {}, [el('span', { cls: 'n', text: s.name }), el('span', { cls: 'abbr', text: s.abbr })]),
          el('span', { cls: 'hint', text: off(s) ? 'Switched off' + (counts ? ' · ' + counts : '') : counts || 'In use' }),
        ]));
      }
      box.append(fold);
    }
    $('#src-all').hidden = c.sources.length <= 1;
    if (c.sources.length <= 1) box.append(el('p', { cls: 'note', text: 'Add a content file to choose from more books.' }));
    // single items: one button per kind, as in MPMB's Source Selection dialog, with how many are left out
    const kinds = $('#excl-kinds');
    kinds.textContent = '';
    for (const [type, label] of EXCL_KINDS) {
      const n = (c.excluded && c.excluded[type]) || 0;
      const b = el('button', { cls: 'btn sm', type: 'button', 'data-excl': type, title: n ? n + ' left out' : 'All in use' }, [el('span', { text: label.replace('/', '/​') })]);   // may break after the slash
      if (n) b.append(el('span', { cls: 'chip', text: n + ' out' }));
      kinds.append(b);
    }
    const used = inUse(c);
    $('#sources-chip').textContent = c.sources.filter((s) => !off(s)).length + ' of ' + c.sources.length + ' in use';
    // the line in the Character card
    const onlySRD = !c.files.length && !c.userScript;
    $('#content-hint-text').textContent = onlySRD ? 'Content: SRD only.' : 'Content: ' + (used.length > 8 ? used.length + ' books' : used.map((s) => s.abbr).join(', ') || 'no books switched on') + (c.userScript ? ' + your script' : '') + '.';
    $('#content-hint-link').textContent = onlySRD ? 'Add books' : 'Change';
    // the Sheet tab's card
    const nOut = EXCL_KINDS.reduce((t, k) => t + ((c.excluded && c.excluded[k[0]]) || 0), 0);
    $('#sources-sum-text').textContent = onlySRD ? 'The sheet has the SRD (the free rules) only. Add content files for more books.'
      : (n ? n + (n === 1 ? ' content file' : ' content files') : 'No content files') + (c.userScript ? ' and a pasted script' : '') + ' · ' + used.length + ' of ' + c.sources.length + ' books in use' + (nOut ? ' · ' + nOut + ' single items left out' : '') + '.';
  }
  // the books the user wants switched off while the sheet is still applying an earlier change (null: none waiting)
  let want = null, applying = false;
  const openGroups = new Set();
  // apply the books as ticked; ticks made meanwhile are applied together afterwards
  async function applySources() {
    if (applying || !want || !state.content) return;
    applying = true;
    const wanted = Array.from(want);
    const res = await contentOp('setSources', { excluded: wanted }, { working: 'Updating the lists…' });
    applying = false;
    if (!res) { want = null; renderContent(); return; }   // failed: show the books as the sheet has them
    const now = state.content ? state.content.sources.filter((s) => s.excluded).map((s) => s.key).sort().join('|') : '';
    if (!want || Array.from(want).sort().join('|') === now) { want = null; renderContent(); return; }
    applySources();
  }
  function wantSources(fn) {
    if (!state.content || !state.worker) return;
    if (!want) want = new Set(state.content.sources.filter((s) => s.excluded).map((s) => s.key));
    for (const s of state.content.sources) { const o = fn(s); if (o === true) want.add(s.key); else if (o === false) want.delete(s.key); }
    renderContent();
    applySources();
  }

  // MPMB's buttons in Source Selection, in its order and with its names
  const EXCL_KINDS = [['class', 'Classes/Archetypes'], ['race', 'Player Species'], ['background', 'Backgrounds'], ['background feature', 'Background Features'],
    ['weapon', 'Weapons/Attacks'], ['ammo', 'Ammunition'], ['magic item', 'Magic Items'], ['armor', 'Armor'], ['spell', 'Spells/Psionics'], ['feat', 'Feats'],
    ['companion', 'Companion Options'], ['creature', 'Creatures']];
  // MPMB's selection dialog for one kind, answered by the user (a user change: MPMB waits, or restart and replay)
  async function excludeOp(type) {
    contentBusy(true);
    const res = await U.send('excludeItems', { type });
    contentBusy(false);
    if (!res) { showResult('err', 'Something went wrong; see Settings → Messages from the sheet.'); return; }
    state.content = res.content; state.saved = res.saved;
    idbPut(state.sheetKey, { saved: res.saved, date: Date.now() });
    renderContent();
    const errs = (res.errors || []).map((e) => 'Script error: ' + e);
    if (errs.length) showResult('err', 'The sheet reported a problem.', errs);
    else if (res.changed) showResult('ok', 'Done: the sheet updated its lists.');
    else $('#content-result').hidden = true;
  }
  function contentBusy(on) {
    // the book ticks stay usable: a tick made meanwhile waits for the change before it (applySources)
    for (const n of $$('#content-file, #paste-open, #paste-save, #paste-cancel, #content-files button, [data-excl]')) n.disabled = on;
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
    try { res = await state.worker.call(op, args); } catch (e) { setBusy(-1); contentBusy(false); showResult('err', 'Something went wrong: ' + (e.message || e)); return null; }
    for (const s of res.changes || []) apply(s);
    state.log = res.log; state.content = res.content; state.saved = res.saved;
    idbPut(state.sheetKey, { saved: res.saved, date: Date.now() });
    renderContent(); refreshDerived(); spellsSoon(true); saveSoon();
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
      if (added.length) lines.push(added.length > 6 ? added.length + ' new books.' : 'New books: ' + added.map((s) => s.name).join(', ') + '.');
      if (off.length) lines.push((off.length > 6 ? off.length + ' of them are' : listNames(off) + (off.length === 1 ? ' is' : ' are')) + ' switched off for now (the sheet does this for some books). Switch ' + (off.length === 1 ? 'it' : 'them') + ' on under Books.');
      showResult('ok', 'Added ' + ctx.name + ' in ' + fmtS(res.ms) + '.', lines.concat(other, errs));
    } else if (op === 'setUserScript' && !(ctx && ctx.removed)) {
      if (worked) { showResult('ok', 'Your script was added to the sheet.', other.concat(errs)); $('#paste-box').hidden = true; $('#paste-open').setAttribute('aria-expanded', 'false'); }
      else showResult('err', 'The script wasn’t added. Your earlier content is unchanged.', other.concat(errs));
    } else if (ctx && ctx.removed) {
      showResult(other.length || errs.length ? 'err' : 'ok', 'Removed ' + ctx.removed + '.', other.concat(errs));
    } else if (other.length || errs.length) showResult('err', 'The sheet reported a problem.', other.concat(errs));
    else $('#content-result').hidden = true;
    return res;
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
    $('#excl-kinds').addEventListener('click', (e) => {
      const b = e.target.closest('[data-excl]');
      if (b && state.worker && !b.disabled) excludeOp(b.dataset.excl);
    });
    $('#source-list').addEventListener('change', (e) => {
      if (!e.target.matches('[data-source]')) return;
      const key = e.target.dataset.source, out = !e.target.checked;
      wantSources((s) => (s.key === key ? out : undefined));
    });
    $('#source-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-src-group]');
      if (!b) return;
      const out = b.dataset.srcTo === 'off';
      wantSources((s) => (s.group === b.dataset.srcGroup ? out : undefined));
    });
    $('#src-all-on').addEventListener('click', () => wantSources(() => false));
    $('#src-all-off').addEventListener('click', () => wantSources(() => true));
  }

  Object.assign(U, {
    kb, renderContent, wireContent
  });
})();
