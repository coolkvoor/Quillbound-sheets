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

  const api = { options, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBClasses = api;
})(typeof self !== 'undefined' ? self : this);
