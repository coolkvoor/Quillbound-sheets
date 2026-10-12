/* Add-on content: MPMB's "Add Extra Materials" and "Source Material" bookmarks, driven the way a user would.
 * The app picks the file (Acrobat's file picker), then MPMB's own dialogs run with the buttons pressed for the user:
 * its code stores the script, runs it, rebuilds its lists and dropdowns, and reports success or errors with alerts.
 * Shared by the worker and the Node tests. */
(function (root) {
  'use strict';
  // Where MPMB keeps the content in the PDF; the app saves these per sheet and restores them before MPMB starts
  const STATE_FIELDS = ['User_Imported_Files.Stringified', 'User Script', 'CurrentSources.Stringified'];
  const LINKS = { find: 'https://www.flapkan.com/mpmb/index', howto: 'https://www.flapkan.com/how-to/add-more-content' };
  const FILES_DIALOG = 'IMPORT CUSTOM SCRIPT DIALOG', MANUAL_DIALOG = 'MANUAL CUSTOM SCRIPT DIALOG', SOURCES_DIALOG = 'SOURCE SELECTION DIALOG';

  // Runs inside the sheet's realm, where MPMB's globals live. Index loops only: MPMB changes Array.prototype.
  const INFO = '(' + function () {
    var files = [];
    for (var k in CurrentScriptFiles) {
      var m = /^(\d+\/\d+\/\d+(?: [\d:]+)?) - (.*)$/.exec(k);
      files.push({ key: k, name: m ? m[2] : k, date: m ? m[1] : '', size: String(CurrentScriptFiles[k]).length });
    }
    var lists = [['class', ClassList], ['subclass', ClassSubList], ['species', RaceList], ['background', BackgroundList], ['feat', FeatsList], ['spell', SpellsList], ['magic item', MagicItemsList], ['creature', CreatureList]];
    var counts = {};
    for (var i = 0; i < lists.length; i++) {
      for (var key in lists[i][1]) {
        var o = lists[i][1][key];
        var src = o && o.source ? parseSource(o.source) : false;
        if (!src) continue;
        var seen = {};
        for (var j = 0; j < src.length; j++) {
          var s = src[j][0];
          if (seen[s]) continue;
          seen[s] = true;
          if (!counts[s]) counts[s] = {};
          counts[s][lists[i][0]] = (counts[s][lists[i][0]] || 0) + 1;
        }
      }
    }
    var sources = [];
    for (var sk in SourceList) {
      var S = SourceList[sk];
      var group = S.group || 'other';
      if (group === 'default') continue;   // MPMB's Source Selection dialog leaves these out too
      // the name MPMB shows for the source in its dialog
      var dlg = S.name.replace(RegExp(group + ' ?:? ?', 'i'), '') + ' (' + S.abbreviation + ')';
      if (group === 'Unearthed Arcana' && S.date) dlg = S.date + ' ' + dlg;
      sources.push({ key: sk, name: S.name, abbr: S.abbreviation, group: group, date: S.date || '', url: S.url || '', excluded: CurrentSources.globalExcl.indexOf(sk) !== -1, dialogName: dlg, counts: counts[sk] || {} });
    }
    return JSON.stringify({ files: files, userScript: String(What('User Script')).length, sources: sources });
  } + ')()';

  function info(engine) { return JSON.parse(engine.evalExpr(INFO)); }

  // Run one MPMB action with prepared answers; report the alerts it raised and the new content state
  function run(engine, code, label, prepare) {
    const seq = engine.logSeq;
    engine.clearQueues();
    prepare();
    engine.action(code, label);
    engine.clearQueues();
    const alerts = engine.log.alerts.filter((a) => a.seq > seq).map((a) => ({ title: a.title, msg: a.msg }));
    const errors = engine.log.errors.filter((e) => e.seq > seq).map((e) => e.where + ': ' + e.msg);
    return { alerts, errors, content: info(engine) };
  }

  // "Add Extra Materials" → "Import a file with additional material" → Add file → Apply changes
  function addFile(engine, text) {
    return run(engine, 'ImportScriptFileDialog();', 'content:add-file', () => {
      engine.queueFile(text);
      engine.queueDialog({ name: FILES_DIALOG, steps: [{ press: 'bAdd' }] });
    });
  }
  // Same dialog: select the file → DELETE → Apply changes
  function removeFile(engine, key) {
    return run(engine, 'ImportScriptFileDialog();', 'content:remove-file', () => {
      engine.queueDialog({ name: FILES_DIALOG, steps: [{ pick: { id: 'scrF', item: key } }, { press: 'scrF' }, { press: 'bRem' }] });
    });
  }
  // "Add material manually (copy-paste)": replaces the whole pasted script.
  // MPMB splits a long script over several dialogs; the first gets the new text, the others are emptied.
  function setUserScript(engine, text) {
    if (!String(text).trim()) return removeUserScript(engine);
    const parts = Number(engine.evalExpr('(String(What("User Script")).match(/(.|\\r){1,65500}/g) || []).length')) || 0;
    return run(engine, 'AddUserScript();', 'content:user-script', () => {
      for (let i = 0; i < Math.max(1, parts); i++) engine.queueDialog({ name: MANUAL_DIALOG, steps: [{ set: { jscr: i === 0 ? String(text) : '' } }] });
    });
  }
  // Emptying the script in MPMB's dialog resets the lists without re-running the imported files (their content
  // disappears until the sheet is reopened), so this follows the file dialog's steps instead
  function removeUserScript(engine) {
    return run(engine, 'Value("User Script", ""); InitiateLists(); RunUserScript(false, false); setStuffAfterUserScripts(); resourceDecisionDialog(false, false, true);', 'content:user-script', () => {
      engine.queueDialog({ name: SOURCES_DIALOG, steps: [] });
    });
  }
  // "Source Material": move sourcebooks between Excluded and Included with MPMB's < and > buttons, then Apply
  function setSources(engine, excludedKeys) {
    const want = new Set(excludedKeys);
    const steps = [];
    for (const s of info(engine).sources) {
      const excl = want.has(s.key);
      if (excl === s.excluded) continue;
      if (excl) steps.push({ pick: { id: 'IncL', item: s.dialogName } }, { press: 'IncL' }, { press: 'BTL1' });
      else steps.push({ pick: { id: 'ExcL', item: s.dialogName } }, { press: 'ExcL' }, { press: 'BTR1' });
    }
    if (!steps.length) return { alerts: [], errors: [], content: info(engine) };
    return run(engine, 'resourceDecisionDialog();', 'content:sources', () => engine.queueDialog({ name: SOURCES_DIALOG, steps }));
  }

  // The values to keep with the sheet, and putting them back: preset before start(), then restore() after it
  function state(engine) {
    const out = {};
    for (const n of STATE_FIELDS) { const f = engine.getField(n); if (f) out[n] = f.valueAsString; }
    return out;
  }
  // In Acrobat the saved PDF also holds the rebuilt dropdowns; here MPMB rebuilds them (Source Selection → Apply)
  function restore(engine) {
    return run(engine, 'resourceDecisionDialog(false, false, true);', 'content:restore', () => engine.queueDialog({ name: SOURCES_DIALOG, steps: [] }));
  }

  const api = { STATE_FIELDS, LINKS, info, addFile, removeFile, setUserScript, setSources, state, restore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBContent = api;
})(typeof self !== 'undefined' ? self : this);
