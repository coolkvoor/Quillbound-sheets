/* Restart and replay: MPMB's dialogs and questions answered by the user, without pausing MPMB's code.
 * A change runs with engine.stopForUser on. If MPMB opens a dialog (or asks a yes/no question) that nobody can
 * answer, the run stops there: the dialog stays open in that copy of MPMB (its handlers keep working) and the user
 * answers it. Then a fresh copy starts from the character as it was before the change (the same state the autosave
 * keeps, as Acrobat reopening a saved PDF), and the change runs again with the user's answers queued in order
 * (engine.setReplay); a replayed dialog goes through exactly the same steps as when the user answered it. A dialog
 * after that one stops the new copy the same way. The copy that finishes the change becomes the live one.
 *
 * host: { live: engine, fresh(state) → engine started from that state, user(request) → reply }
 *   request: { kind: 'dialog', id, name, title, desc (first time), values, lists, enabled, shown, red, focus }
 *            or { kind: 'question', title, msg, type }; reply: { set, pick, press } / { yes }; null = cancel
 * Every call may return a Promise (a copy can be a worker), so act() is async.
 * Shared by the worker and the Node tests. */
(function (root) {
  'use strict';
  const MAX_ROUNDS = 12;   // a chain of dialogs in one change (subclass, then the changes reminder, …)

  // action(engine): the change itself (a commit, a tap, …), run on the live copy, then on each fresh copy
  async function act(host, action) {
    let eng = host.live;
    const before = await eng.exportState();
    const answers = [];
    const t0 = Date.now();
    let restartMs = 0;
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      await eng.setReplay(answers);
      await eng.stopForUser(true);
      let failed = null, result;
      try { result = await action(eng); } catch (e) { if (!(e && e.mpmbStop)) failed = e; }
      await eng.stopForUser(false);
      await eng.setReplay([]);
      const s = await eng.takeStopped();
      if (!s) {
        if (failed) throw failed;
        return { engine: eng, result, answers, restarts: round, restartMs, ms: Date.now() - t0 };
      }
      if (round === MAX_ROUNDS) throw new Error('The sheet kept asking: more than ' + MAX_ROUNDS + ' dialogs in one change');
      if (s.kind === 'question') {
        const r = await host.user({ kind: 'question', title: s.title, msg: s.msg, type: s.type });
        answers.push({ kind: 'question', yes: !!(r && r.yes), cancel: !!(r && r.cancel) });
      } else {
        // the stopped dialog, live: each reply runs MPMB's handler for it in this copy, until the dialog ends
        const replies = [];
        let req = await s.request();
        for (;;) {
          const r = await host.user(req);
          replies.push(r || null);
          if ((await s.step(r || null)) !== null) break;
          req = await s.request();
        }
        await s.finish();
        answers.push({ kind: 'dialog', name: s.name, replies });
      }
      const tr = Date.now();
      eng = await host.fresh(before);
      restartMs += Date.now() - tr;
    }
  }

  const api = { act };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBReplay = api;
})(typeof self !== 'undefined' ? self : this);
