/* Spells: MPMB's spell selection and spell sheet, with the choosing done on the app's own screen.
 * options(): runs MPMB's spell dialogs (AskUserSpellSheet) once to learn each caster's lists and counts, then cancels.
 * choose(): writes the user's picks where MPMB's dialogs keep them (CurrentSpells[caster].selectCa / selectSp /
 *   selectPrep / typeList), then runs MPMB's own GenerateSpellSheet with its dialogs confirmed as loaded.
 * sheet(): reads the generated spell sheet pages (SSfront / SSmore templates) back as rows.
 * Shared by the worker and the Node tests. */
(function (root) {
  'use strict';
  const SELECT = 'SPELL SELECTION DIALOG', PREPARED = 'PREPARED SPELLS DIALOG', ORDER = 'SPELL LIST GENERATION DIALOG', BOOK = 'EXTRA SPELLBOOK SPELLS DIALOG';
  const ZW = /[\u200B-\u200D\uFEFF]/g;   // zero-width spaces and joiners

  function json(engine, code) { return JSON.parse(engine.evalExpr('JSON.stringify(' + code + ')') || 'null'); }

  // A list from MPMB's dialog ([display → -n], [display → key], ...) as [{ key, name }] in MPMB's order
  function listOf(obj) {
    if (!obj || !obj[0]) return [];
    const out = [];
    for (const disp of Object.keys(obj[0])) { const key = obj[1] && obj[1][disp]; if (key) out.push({ key, name: disp.replace(ZW, '') }); }
    return out;
  }

  // Run MPMB's spell dialogs once without changing anything; returns what each dialog offered
  function probe(engine, forcePrepared) {
    const seq = engine.logSeq;
    // a whole-list caster never has a spellbook; an empty one left by an earlier app version empties its prepare list
    engine.evalExpr('for (var k in CurrentSpells) if (CurrentSpells[k].typeSp === "list") { delete CurrentSpells[k].selectSp; delete CurrentSpells[k].selectSpSB; }');
    const saved = forcePrepared ? json(engine, 'Object.keys(CurrentSpells).map(function (k) { return [k, CurrentSpells[k].typeList]; })') : null;
    if (forcePrepared) engine.evalExpr('for (var k in CurrentSpells) if (CurrentSpells[k].known && CurrentSpells[k].known.prepared) CurrentSpells[k].typeList = 3;');
    engine.clearQueues();
    for (let i = 0; i < 12; i++) { engine.queueDialog({ name: SELECT, steps: [], capture: true }); engine.queueDialog({ name: PREPARED, steps: [], capture: true }); engine.queueDialog({ name: BOOK, steps: [{ end: 'ok' }] }); }
    engine.queueDialog({ name: ORDER, steps: [{ end: 'cancel' }], capture: true });
    engine.evalExpr('AskUserSpellSheet(); SetStringifieds("spells");');
    engine.clearQueues();
    if (saved) engine.evalExpr('(function (s) { for (var i = 0; i < s.length; i++) if (CurrentSpells[s[i][0]]) { if (s[i][1] === null || s[i][1] === undefined) delete CurrentSpells[s[i][0]].typeList; else CurrentSpells[s[i][0]].typeList = s[i][1]; } SetStringifieds("spells"); })(' + JSON.stringify(saved) + ')');
    // taken out of the log: the lists are large (about 1 MB per caster) and the log keeps 200 entries
    return engine.logSince(seq).dialogs.filter((d) => d.data).map((d) => { const out = { name: d.name, data: d.data }; delete d.data; return out; });
  }

  const RADIO = { 1: 'Spells up to the highest level I can cast', 2: 'All chosen spells, any level', 3: 'Prepared spells only', 4: 'The full class spell list' };

  function options(engine) {
    const casters = [];
    const byKey = {};
    for (const d of probe(engine, false)) {
      if (d.name !== SELECT) continue;
      const x = d.data;
      const c = {
        key: x.curCast, name: x.header, fullname: x.fullname, typeSp: x.typeSp, maxLevel: x.levelSp || 0,
        cantrips: x.showCa ? { count: (x.nmbrCa || 0) + (x.offsetCa || 0), list: listOf(x.listCa), chosen: (x.selectCa || []).filter(Boolean) } : null,
        spells: x.showSp ? { count: x.typeSp === 'book' ? 0 : (x.nmbrSp || 0) + (x.offsetSp || 0), book: x.typeSp === 'book', list: listOf(x.listSp), chosen: (x.selectSp || []).filter(Boolean) } : null,
        show: x.showSpRadio ? { value: x.selectSpRadio || 1, choices: [] } : null,
        prepared: null,
        // bonus spells (a feat, species trait or magic item that gives spells, such as Magic Initiate): one pick per
        // slot, each from its own list, named by MPMB ("Cantrip", "1st-Level")
        bonus: x.showBo && x.nmbrBo ? (x.namesBo || []).slice(0, x.nmbrBo).map((label, i) => ({ label: label || 'Spell', list: listOf((x.listBo || [])[i]), chosen: (x.selectBo || [])[i] || '' })) : null,
      };
      casters.push(c); byKey[c.key] = c;
    }
    // the prepared spells dialog only opens for "Prepared spells only", so ask for it once more with that set
    const prepCasters = json(engine, 'Object.keys(CurrentSpells).filter(function (k) { return CurrentSpells[k].known && CurrentSpells[k].known.prepared; })') || [];
    if (prepCasters.length) {
      for (const d of probe(engine, true)) {
        if (d.name !== PREPARED || !byKey[d.data.curCast]) continue;
        const x = d.data;
        // the dialog's initialize works out the number to prepare (level table or level + modifier, plus bonuses)
        const c = byKey[x.curCast];
        c.prepared = { count: (x.nmbrSp || 0) + (x.offsetSp || 0), list: listOf(x.listSp), chosen: (x.selectSp || []).filter(Boolean),
          fromBook: !!(c.spells && c.spells.book) };   // a spellbook caster prepares from the spellbook, so the app offers the chosen book spells
      }
      for (const c of casters) if (!c.prepared && prepCasters.indexOf(c.key) !== -1 && c.spells && c.spells.book) {
        c.prepared = { count: 0, list: [], chosen: [], fromBook: true };
      }
    }
    for (const c of casters) if (c.show) c.show.choices = [1, 2, c.prepared ? 3 : 0, 4].filter(Boolean).map((v) => ({ value: v, name: RADIO[v] }));
    // MPMB keeps a spellbook in two parts: the first 20 spells in its spell dialog (selectSp), the rest in its extra
    // spellbook dialog (selectSpSB). Leaving the second part out made the next save drop it, and every prepared spell in it.
    for (const c of casters) {
      if (!c.spells || !c.spells.book) continue;
      const extra = json(engine, 'CurrentSpells[' + JSON.stringify(c.key) + '] && CurrentSpells[' + JSON.stringify(c.key) + '].selectSpSB || []') || [];
      for (const k of extra) if (k && c.spells.chosen.indexOf(k) === -1) c.spells.chosen.push(k);
    }
    // details for the picker, from MPMB's spell list
    const keys = new Set();
    for (const c of casters) for (const part of [c.cantrips, c.spells, c.prepared]) if (part) for (const s of part.list) keys.add(s.key);
    for (const c of casters) if (c.bonus) for (const slot of c.bonus) for (const s of slot.list) keys.add(s.key);
    const info = json(engine, '(function (ks) { var o = {}; for (var i = 0; i < ks.length; i++) { var s = SpellsList[ks[i]]; if (!s) continue; o[ks[i]] = { name: s.name, level: s.level, school: s.school || "", time: s.time || "", range: s.range || "", components: s.components || "", duration: s.duration || "", ritual: !!s.ritual, description: s.description || "", source: stringSource(s, "first,abbr", "", "") }; } return o; })(' + JSON.stringify(Array.from(keys)) + ')');
    return { casters, spells: info || {}, key: key(engine) };
  }

  // picks: { caster: { cantrips: [keys], spells: [keys], prepared: [keys], show: 1-4, bonus: [key per slot] } }
  // opts.glossary: MPMB's Glossary tick box in its spell list dialog (a picture explaining the columns and marks); MPMB
  // only remembers it until the sheet is closed, so the app passes it every time
  function choose(engine, picks, opts) {
    const seq = engine.logSeq;
    // Bonus spells go through MPMB's own spell dialog, as if picked there: its commit works out the rest (which spells
    // are bonus spells, a "once per long rest" first column). Each slot's drop-down takes the spell's name as the
    // dialog lists it, so the names come from a first, unchanged run of the dialogs.
    const bonusPicks = Object.keys(picks || {}).filter((k) => Array.isArray(picks[k].bonus));
    if (bonusPicks.length) {
      const selects = probe(engine, false).filter((d) => d.name === SELECT);
      engine.clearQueues();
      for (const d of selects) {
        const x = d.data, want = picks[x.curCast] && picks[x.curCast].bonus, set = {};
        if (want) for (let i = 0; i < (x.nmbrBo || 0); i++) {
          const byName = ((x.listBo || [])[i] || [])[1] || {};
          let shown = '';
          for (const n of Object.keys(byName)) if (byName[n] === want[i]) { shown = n; break; }
          set['Bo' + ('0' + (i + 1)).slice(-2)] = shown;
        }
        engine.queueDialog({ name: SELECT, steps: want ? [{ set }] : [] });
      }
      for (let i = 0; i < 12; i++) { engine.queueDialog({ name: PREPARED, steps: [] }); engine.queueDialog({ name: BOOK, steps: [{ end: 'ok' }] }); }
      engine.queueDialog({ name: ORDER, steps: [{ end: 'cancel' }] });
      engine.evalExpr('AskUserSpellSheet(); SetStringifieds("spells");');
      engine.clearQueues();
    }
    // A caster that prepares from its whole class list (typeSp "list") has no spellbook or spells known: MPMB takes any
    // selectSp, even an empty one, as a spellbook to prepare from, and the prepared list comes out empty.
    engine.evalExpr('(function (p) { for (var k in p) { var c = CurrentSpells[k]; if (!c) continue; var q = p[k];' +
      ' if (c.typeSp === "list") { delete q.spells; delete c.selectSp; delete c.selectSpSB; }' +
      ' if (q.cantrips) c.selectCa = q.cantrips.slice(0, 20); if (q.spells) { c.selectSp = OrderSpells(q.spells, "single").slice(0, 20); if (q.spells.length > 20) c.selectSpSB = OrderSpells(q.spells, "single").slice(20); else delete c.selectSpSB; }' +
      ' if (q.prepared) c.selectPrep = OrderSpells(q.prepared, "single"); if (q.show) c.typeList = q.show; } SetStringifieds("spells"); })(' + JSON.stringify(picks || {}) + ')');
    engine.clearQueues();
    // Generating runs MPMB's spell dialogs again with what was just set: they are part of this screen, so the app
    // answers them as loaded (OK) instead of showing them; the spellbook dialogs would page through spells beyond the
    // first 20, confirmed as loaded too
    for (let i = 0; i < 12; i++) { engine.queueDialog({ name: SELECT, steps: [] }); engine.queueDialog({ name: PREPARED, steps: [] }); engine.queueDialog({ name: BOOK, steps: [{ end: 'ok' }] }); }
    engine.queueDialog({ name: ORDER, steps: opts && opts.glossary !== undefined ? [{ set: { Glos: !!opts.glossary } }] : [] });
    engine.action('GenerateSpellSheet();', 'spells:generate');
    engine.clearQueues();
    return report(engine, seq);
  }
  function remove(engine) {
    const seq = engine.logSeq;
    engine.action('RemoveSpellSheets();', 'spells:remove');
    return report(engine, seq);
  }
  function report(engine, seq) {
    const { alerts, errors } = engine.logSince(seq);
    return { alerts, errors, sheet: sheet(engine) };
  }

  // The generated spell sheet pages, read back as caster headers and spell rows in page order
  function sheet(engine) {
    const names = engine.fieldNames();
    const pages = [];
    for (const n of names) { const m = /^(P(\d+)\.SS(?:front|more)\.)spells\.remember\.0$/.exec(n); if (m) pages.push({ prefix: m[1], page: Number(m[2]) }); }
    pages.sort((a, b) => a.page - b.page);
    const val = (n) => { const s = engine.snapshot(n); return s.exists ? s : null; };
    const text = (n) => { const s = val(n); return s ? String(s.display !== undefined ? s.display : s.value).trim() : ''; };
    const casters = [], rows = [];
    for (const p of pages) {
      for (let h = 0; h < 4; h++) {
        const cls = text(p.prefix + 'spellshead.class.' + h);
        if (!cls) continue;
        const head = val(p.prefix + 'spellshead.Text.header.' + h);
        if (head && head.hidden) continue;
        casters.push({ key: cls, title: text(p.prefix + 'spellshead.Text.header.' + h), ability: text(p.prefix + 'spellshead.ability.' + h), dc: text(p.prefix + 'spellshead.dc.' + h), attack: text(p.prefix + 'spellshead.attack.' + h), prepare: text(p.prefix + 'spellshead.prepare.' + h) });
      }
      for (let i = 0; ; i++) {
        const rem = val(p.prefix + 'spells.remember.' + i);
        if (!rem) break;
        const name = val(p.prefix + 'spells.name.' + i);
        if (!name || name.hidden || !String(rem.value)) continue;
        const parts = String(rem.value).split('##');
        if (parts[0] === 'setcaptions' || !text(p.prefix + 'spells.name.' + i)) continue;
        // the first column: MPMB's button toggles its "check" field (checkbox ↔ checkedbox, oncelr ↔ oncelr_used)
        const box = val(p.prefix + 'spells.checkbox.' + i);
        const first = (text(p.prefix + 'spells.check.' + i) || parts[1] || '').toLowerCase();
        const toggles = /^check(ed)?box$/.test(first) ? 'prepared' : /^once(sr|lr|day)/.test(first) ? 'used' : '';
        rows.push({
          key: parts[0], first: first.replace(/_used$/, '').replace(/^checkedbox$/, 'checkbox'), caster: parts[2] || '',
          button: box && !box.hidden ? box.name : null, toggles, on: first === 'checkedbox' || /_used$/.test(first),
          name: text(p.prefix + 'spells.name.' + i), description: text(p.prefix + 'spells.description.' + i),
          save: text(p.prefix + 'spells.save.' + i), school: text(p.prefix + 'spells.school.' + i), time: text(p.prefix + 'spells.time.' + i),
          range: text(p.prefix + 'spells.range.' + i), components: text(p.prefix + 'spells.components.' + i), duration: text(p.prefix + 'spells.duration.' + i),
          book: text(p.prefix + 'spells.book.' + i), pageRef: text(p.prefix + 'spells.page.' + i),
        });
      }
    }
    const levels = rows.length ? json(engine, '(function (ks) { var o = {}; for (var i = 0; i < ks.length; i++) if (SpellsList[ks[i]]) o[ks[i]] = SpellsList[ks[i]].level; return o; })(' + JSON.stringify(rows.map((r) => r.key)) + ')') : {};
    for (const r of rows) r.level = levels[r.key] !== undefined ? levels[r.key] : null;
    // the glossary: a picture button on a spell sheet page, shown when MPMB's Glossary option is on
    let glossary = null;
    for (const p of pages) { const g = val(p.prefix + 'spellsgloss.Image'); if (g && !g.hidden) { glossary = g.name; break; } }
    return { pages: pages.length, casters, rows, glossary };
  }

  // Full text of one spell, for the details view
  function details(engine, key) {
    return json(engine, '(function (k) { var s = SpellsList[k]; if (!s) return null; return { name: s.name, level: s.level, school: s.school || "", time: s.time || "", range: s.range || "", components: s.components || "", compMaterial: s.compMaterial || "", duration: s.duration || "", ritual: !!s.ritual, reqLoS: !!s.reqLoS, save: s.save || "", text: s.descriptionFull ? (isArray(s.descriptionFull) ? s.descriptionFull.join("\\n") : String(s.descriptionFull)) : (s.description || ""), source: stringSource(s, "full,page", "", "") }; })(' + JSON.stringify(key) + ')');
  }

  // A tap on a row's first column (MPMB's button): marks a spell prepared, or a once-per-rest spell used
  function tapRow(engine, button) {
    const seq = engine.logSeq;
    engine.clearQueues();
    engine.press(button, 0);
    const menu = engine.takeMenu();   // not a box that toggles: MPMB opened its row menu instead (not handled yet)
    engine.clearQueues();
    const r = report(engine, seq);
    r.menu = !!menu;
    return r;
  }

  // A short string that changes whenever options() could give something else: MPMB's casters with their picks, levels
  // and bonus spells (CurrentSpells, as probe() leaves it), the ability modifiers and level (counts to prepare), the
  // sources and add-on content (the lists). The app re-runs options() only when it changes. A first options() run fills
  // in the dialogs' own parts of CurrentSpells, so options() returns the key from after its run.
  function key(engine) {
    const text = engine.evalExpr('(function () { var c = {}; for (var k in CurrentSpells) { var o = {}, s = CurrentSpells[k];' +
      ' for (var p in s) if (!(s.typeSp === "list" && (p === "selectSp" || p === "selectSpSB"))) o[p] = s[p]; c[k] = o; }' +
      ' var f = ["Str Mod", "Dex Mod", "Con Mod", "Int Mod", "Wis Mod", "Cha Mod", "Character Level", "Proficiency Bonus"].map(function (n) { var x = tDoc.getField(n); return x ? x.valueAsString : ""; });' +
      ' return [c.toSource(), f.join(","), CurrentSources.toSource(), What("User_Imported_Files.Stringified"), What("User Script")].join("|"); })()');
    let h = 0x811c9dc5;   // FNV-1a: the add-on script alone can be hundreds of KB
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return text.length + ':' + (h >>> 0).toString(36);
  }

  const api = { options, choose, remove, sheet, details, tapRow, key };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBSpells = api;
})(typeof self !== 'undefined' ? self : this);
