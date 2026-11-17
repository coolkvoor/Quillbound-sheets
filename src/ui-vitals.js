/* Quillbound Sheets — the vitals strip above the tab bar: hit points (with temporary ones), armor class and initiative,
 * always on screen. A tap on the hit points opens a small panel to take damage, heal or set temporary hit points
 * (#hp-quick); damage takes temporary hit points first, healing stops at the maximum. Initiative rolls (ui-dice.js);
 * armor class goes to the Defense card. The numbers are the sheet's own fields (data-out), so they follow every change.
 * Shares helpers and state through window.MPMBUI. */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, state } = U;

  const num = (name) => { const s = state.snap.get(name); const v = s && s.exists ? String(U.shown(s)).replace(/,/g, '').trim() : ''; return v === '' || isNaN(Number(v)) ? null : Number(v); };
  // an empty current box is a character at full health (the sheet leaves it empty until it is used)
  const current = () => { const c = num('HP Current'), m = num('HP Max'); return c === null ? m : c; };

  function refresh() {
    const cur = num('HP Current'), max = num('HP Max'), temp = num('HP Temp') || 0;
    const shownCur = cur === null ? max : cur;
    $('#vt-hp-cur').textContent = shownCur === null ? '–' : String(shownCur);
    $('#vt-hp-max').textContent = max === null ? '' : '/' + max;
    $('#vt-hp-temp').textContent = temp ? '+' + temp : '';
    $('#vt-hp-temp').hidden = !temp;
    const b = $('#vt-hp');
    b.dataset.state = shownCur === null ? '' : shownCur <= 0 ? 'down' : max && shownCur <= max / 2 ? 'low' : '';
    b.setAttribute('aria-label', 'Hit points: ' + (shownCur === null ? 'not set' : shownCur + (max !== null ? ' of ' + max : '')) + (temp ? ', ' + temp + ' temporary' : '') + '. Tap to change.');
    if ($('#hp-quick').open) fillPanel();
  }
  function fillPanel() {
    const cur = current(), max = num('HP Max'), temp = num('HP Temp') || 0;
    $('#hq-now').textContent = cur === null ? '–' : String(cur);
    $('#hq-max').textContent = max === null ? '' : ' / ' + max;
    $('#hq-temp').textContent = temp ? temp + ' temporary' : 'No temporary hit points';
    $('#hq-down').hidden = !(cur !== null && cur <= 0);
  }
  const amount = () => { const n = Math.floor(Number(String($('#hq-amount').value).trim())); return n > 0 ? n : 0; };
  async function commit(name, value) { await U.send('commit', { name, value: String(value) }); }
  async function damage(n) {
    const temp = num('HP Temp') || 0, cur = current() || 0;
    const fromTemp = Math.min(temp, n);
    if (fromTemp) await commit('HP Temp', temp - fromTemp ? temp - fromTemp : '');
    if (n - fromTemp) await commit('HP Current', Math.max(0, cur - (n - fromTemp)));
    done('Took ' + n + ' damage' + (fromTemp ? ' (' + fromTemp + ' from temporary)' : '') + '.');
  }
  async function heal(n) {
    const max = num('HP Max'), cur = current() || 0;
    await commit('HP Current', max === null ? cur + n : Math.min(max, cur + n));
    done('Healed ' + n + '.');
  }
  async function setTemp(n) { await commit('HP Temp', n || ''); done(n ? 'Temporary hit points: ' + n + '.' : 'Temporary hit points cleared.'); }
  function done(what) {
    $('#hq-amount').value = '';
    $('#hq-last').textContent = what;
    fillPanel();
  }

  function wireVitals() {
    // the strip's numbers are bound to the sheet's fields; redraw it whenever one of them is filled in
    new MutationObserver(refresh).observe($('#vitals-src'), { childList: true, subtree: true, characterData: true });
    $('#vt-hp').addEventListener('click', () => {
      if (!state.worker) return;
      $('#hq-last').textContent = '';
      $('#hq-amount').value = '';
      fillPanel();
      $('#hp-quick').showModal();
    });
    $('#vt-ac').addEventListener('click', () => {
      const card = $('#f-armor') && $('#f-armor').closest('.card');
      U.goTo('combat');
      if (card) { if (card.classList.contains('folded') || card.classList.contains('user-hidden')) U.peekCard(card); setTimeout(() => card.scrollIntoView({ behavior: U.reduceMotion() ? 'auto' : 'smooth', block: 'start' }), 60); }
    });
    const act = (fn) => async () => { const n = amount(); if (!n) { $('#hq-amount').focus(); return; } await fn(n); };
    $('#hq-damage').addEventListener('click', act(damage));
    $('#hq-heal').addEventListener('click', act(heal));
    $('#hq-settemp').addEventListener('click', () => setTemp(amount()));
    for (const b of document.querySelectorAll('#hp-quick [data-hq]')) b.addEventListener('click', () => { const by = Number(b.dataset.hq); if (by < 0) damage(-by); else heal(by); });
    $('#hq-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); act(damage)(); } });
    $('#hq-close').addEventListener('click', () => $('#hp-quick').close());
    $('#hq-card').addEventListener('click', () => {
      $('#hp-quick').close();
      const card = $('#f-hp') && $('#f-hp').closest('.card');
      U.goTo('combat');
      if (card) { if (card.classList.contains('folded') || card.classList.contains('user-hidden')) U.peekCard(card); setTimeout(() => card.scrollIntoView({ behavior: U.reduceMotion() ? 'auto' : 'smooth', block: 'center' }), 60); }
    });
    refresh();
  }

  Object.assign(U, { wireVitals });
})();
