/* Quillbound Sheets — import a character from another MPMB sheet (MPMB's Direct Import, Functions → Import/Export).
   Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, state } = U;

  // MPMB's Direct Import opens the sheet to import from as a second document (app.openDoc) and reads its fields and its
  // MPMB variables while it changes this one. Each sheet needs its own JavaScript realm (MPMB changes built-in
  // prototypes and keeps its state in globals), and both must run on one thread, as MPMB reads the other sheet
  // directly. A worker has only one realm, so the import runs on the page in two hidden same-origin frames, each with
  // its own copy of the engine: the sheet imported from, and this sheet started from the character as it is now. The
  // result is a saved state (as the autosave keeps it), which becomes this sheet's character and is opened again.
  async function realmSource() {
    const tag = document.getElementById('mpmb-realm-src');   // the single-file builds carry engine.js + content.js here
    if (tag) return tag.textContent;
    const parts = await Promise.all(['engine.js', 'content.js'].map(async (f) => {
      const r = await fetch(f);
      if (!r.ok) throw new Error('could not load ' + f);
      return r.text();
    }));
    return parts.join('\n;\n');
  }
  function makeRealm(src) {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    document.body.append(frame);
    const w = frame.contentWindow;
    // the frame's own eval, called indirectly: the code runs in the frame's global scope
    const evalGlobal = (code) => w.eval(code);
    evalGlobal(src);
    return { frame, w, evalGlobal };
  }
  // MPMB started on a sheet model in a frame. Values are made in the frame's realm (MPMB checks "instanceof Array").
  function startIn(realm, modelJSON, opts, saved) {
    const e = realm.w.MPMBEngine.createEngine(realm.w.JSON.parse(modelJSON), { global: realm.w, evalGlobal: realm.evalGlobal }, opts);
    if (saved) e.importState(realm.w.JSON.parse(JSON.stringify(saved)));
    e.setStandingAnswer('EXPERIENCE POINTS DIALOG', { steps: [{ end: 'cancel' }] });
    e.start();
    return e;
  }
  const pause = () => new Promise((r) => setTimeout(r, 30));   // lets the busy text show before the page is busy

  async function importFrom(file) {
    const busy = $('#import-status');
    const say = (t) => { busy.textContent = t; busy.hidden = false; };
    const frames = [];
    U.setBusy(1);
    try {
      say('Reading ' + file.name + '…');
      const buf = await file.arrayBuffer();
      const fromJSON = await state.worker.call('parseModel', { bytes: buf }, [buf]);
      const toJSON = state.modelJSON || await state.worker.call('modelJSON', {});
      state.modelJSON = toJSON;
      const now = await state.worker.call('exportState', {});
      const src = await realmSource();
      say('Opening ' + file.name + ' with MPMB’s scripts…');
      await pause();
      const from = makeRealm(src); frames.push(from.frame);
      startIn(from, fromJSON, { fileName: file.name });
      say('Importing into this sheet (MPMB’s Direct Import)…');
      await pause();
      const to = makeRealm(src); frames.push(to.frame);
      let opened = 0;
      const e = startIn(to, toJSON, { fileName: state.fileName, openDoc: () => { opened++; return from.w; }, onCloseDoc: () => {} }, now);
      // the sheet's dropdowns, as when the app opens a sheet (worker startEngine)
      to.w.MPMBContent.restore(e);
      const seen = e.log.alerts.length;
      // MPMB's import dialog asks for the file's path; the file is already picked
      e.queueDialog({ name: 'IMPORT FROM PDF DIALOG', steps: [{ set: { fLoc: file.name } }] });
      e.action('DirectImport(true)', 'import');
      const alerts = Array.prototype.slice.call(e.log.alerts, seen).map((a) => ({ title: String(a.title || ''), msg: String(a.msg || '') }));
      const done = opened === 1 && alerts.some((a) => /Things to consider about the import/.test(a.title));
      if (!done) {
        busy.hidden = true;
        await U.showNotice(alerts.length ? alerts : [{ title: 'Import', msg: 'MPMB didn’t import anything from ' + file.name + '.' }], 'Import from another sheet');
        return;
      }
      const st = JSON.parse(JSON.stringify(e.exportState()));
      for (const f of frames.splice(0)) f.remove();
      // the imported character becomes this sheet's character, opened again as from the autosave (MPMB redoes its
      // own settings on opening, such as a cantrip's spellcasting ability)
      U.stopAutosave();
      await U.idbPut(state.charKey, { state: st, date: Date.now(), name: 'imported from ' + file.name });
      busy.hidden = true;
      $('#sheet').hidden = true; $('#start').hidden = false;
      await U.openSheet(state.bytes.slice(0), state.fileName, false);
      await U.showNotice(alerts, 'Imported from ' + file.name);
    } catch (err) {
      busy.hidden = true;
      const m = String(err && err.message || err);
      await U.showNotice([{ title: 'Import', msg: /NOT_MPMB/.test(m) ? file.name + ' doesn’t look like an MPMB character sheet.' : 'The import stopped: ' + m }], 'Import from another sheet');
    } finally {
      for (const f of frames) f.remove();
      U.setBusy(-1);
    }
  }

  function wireImport() {
    const input = $('#import-file');
    $('#import-char').addEventListener('click', async () => {
      const yes = await U.askYesNo({
        title: 'Import from another sheet',
        msg: 'MPMB opens another of its character sheets (an older version, the other design, or a copy) and goes through every field and layout setting in it to make this sheet the same. MPMB’s automation runs again, so it uses this sheet’s newer code.\n\nThe character on this sheet is replaced. Download it first if you want to keep it.\n\nPick the PDF to import from?',
      });
      if (yes) input.click();
    });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (f && state.worker) importFrom(f);
    });
  }

  Object.assign(U, { wireImport });
})();
