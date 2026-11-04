/* Classes: MPMB's Class Selection dialog (SelectClass), with the choosing done on the app's own screen.
 * options(): opens the dialog once to read its lists (classes, subclasses per class) and current rows, then cancels.
 * apply(): answers the dialog as a user would: for each row picks the class, the subclass and the level in its
 *   drop-downs (MPMB's own handlers fill in the text and the total), then presses Apply.
 * Shared by the worker and the Node tests. */
(function (root) {
  'use strict';
  const DIALOG = 'CLASS SELECTION DIALOG', ROWS = 10;

  function options(engine) {
    const seq = engine.logSeq;
    engine.clearQueues();
    engine.queueDialog({ name: DIALOG, steps: [{ end: 'cancel' }], capture: true });
    engine.action('SelectClass();', 'classes:read');
    engine.clearQueues();
    const said = engine.logSince(seq);
    const d = said.dialogs.filter((x) => x.name === DIALOG && x.data)[0];
    if (!d) return { available: false, alerts: said.alerts };
    const x = d.data;
    delete d.data;   // read once; the log keeps 200 entries
    const names = (o) => Object.keys(o || {}).filter((k) => k.trim());
    const classes = names(x.classes).map((name) => {
      const key = x.classesRef[name];
      return { key, name, subclasses: names(x.subclasses[key]) };
    });
    const byKey = {};
    for (const c of classes) byKey[c.key] = c;
    const rows = (x.curSelec || []).filter((r) => r && r.length && (r[1] || r[2])).map((r) => ({
      level: Number(r[0]) || 0, text: r[1] || '', cls: r[2] && byKey[r[2]] ? byKey[r[2]].name : '',
      sub: r[3] ? (engine.evalExpr('ClassSubList[' + JSON.stringify(r[3]) + '] ? ClassSubList[' + JSON.stringify(r[3]) + '].subname : ""') || '') : '',
    }));
    // names MPMB shows for subclasses that need a level first (subclassGainedLevel)
    const gained = JSON.parse(engine.evalExpr('JSON.stringify((function (ks) { var o = {}; for (var i = 0; i < ks.length; i++) o[ks[i]] = ClassList[ks[i]] && ClassList[ks[i]].subclassGainedLevel || 3; return o; })(' + JSON.stringify(classes.map((c) => c.key)) + '))'));
    for (const c of classes) c.subclassLevel = gained[c.key] || 3;
    return { available: true, classes, rows, level: Number(x.currentLevel) || 0, text: x.finalText || '' };
  }

  // rows: [{ cls: class name as listed, sub: subclass name ('' for none), level }] in order; the first row is the
  // class taken at 1st level. Rows left out are cleared.
  function apply(engine, rows) {
    const seq = engine.logSeq;
    const steps = [];
    // clear every row first, so a class can move between rows (each row's list leaves out classes used elsewhere)
    for (let i = 0; i < ROWS; i++) steps.push({ pick: { id: 'r' + i + 'CD', item: ' ' } }, { press: 'r' + i + 'CD' });
    rows.slice(0, ROWS).forEach((r, i) => {
      steps.push({ pick: { id: 'r' + i + 'CD', item: r.cls } }, { press: 'r' + i + 'CD' });
      if (r.sub) steps.push({ pick: { id: 'r' + i + 'SD', item: r.sub } }, { press: 'r' + i + 'SD' });
      steps.push({ set: { ['r' + i + 'LV']: String(Math.max(1, Math.min(20, Number(r.level) || 1))) } }, { press: 'r' + i + 'LV' });
    });
    engine.clearQueues();
    engine.queueDialog({ name: DIALOG, steps });
    engine.action('SelectClass();', 'classes:apply');
    engine.clearQueues();
    const { alerts, errors, dialogs } = engine.logSince(seq);
    return { alerts, errors, dialogs: dialogs.map((d) => d.name + '/' + d.answered) };
  }

  // which feature the sheet's extra choices belong to: links, [label, parent feature name] for each class feature with an
  // extraname ("Focus Feature" → Monk's Focus), its own or one of its choices' ("Monk 5" → Monk's Focus, "Druid 2" →
  // Wild Shape). The sheet writes those choices in Notes with the label as their source; the app shows them under the
  // feature (features.js merge). names: each class's names (class and subclass, long and short), as its notes may use
  // another one than its features ("Warrior of Shadow 11" and "Shadow 3").
  function links(engine) {
    return JSON.parse(engine.evalExpr('JSON.stringify((function () { var out = [], seen = {};'
      + ' function add(l, n) { if (typeof l !== "string" || !l || typeof n !== "string" || seen[l + "|" + n]) return; seen[l + "|" + n] = 1; out.push([l, n]); }'
      + ' for (var c in classes.known) { var cl = CurrentClasses[c]; if (!cl || !cl.features) continue;'
      + '  for (var p in cl.features) { var f = cl.features[p]; if (!f || typeof f !== "object") continue; var n = typeof f.name === "string" ? f.name : p;'
      + '   add(f.extraname, n);'
      + '   for (var k in f) { var o = f[k]; if (o && typeof o === "object" && !isArray(o) && typeof o.extraname === "string") add(o.extraname, n); } } }'
      + ' var names = []; for (var c2 in classes.known) { var k2 = CurrentClasses[c2]; if (!k2) continue; var nm = [];'
      + '  ["name", "nameShort", "subname", "subnameShort", "fullname"].forEach(function (x) { if (typeof k2[x] === "string" && k2[x]) nm.push(k2[x]); }); names.push(nm); }'
      + ' return { links: out, names: names }; })())'));
  }

  const api = { options, apply, links };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBClasses = api;
})(typeof self !== 'undefined' ? self : this);
