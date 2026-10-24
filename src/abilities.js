/* Ability scores: MPMB's Ability Scores dialog (AbilityScores_Button), with the editing on the app's own screen.
 * options(): MPMB's columns (base, background, feats, class ASIs, items, override, maximum, extra columns), the current
 *   scores, and its explanation of where improvements come from (the text it puts in the ability tooltips).
 * preview(): totals and point-buy cost for proposed column values, by MPMB's own getAbilityScoreTotals/ASCalcPointBuy.
 * apply(): answers the dialog as a user would (types each changed box, MPMB updates its totals), then presses Apply.
 * Shared by the worker and the Node tests. */
(function (root) {
  'use strict';
  const DIALOG = 'ABILITY SCORES DIALOG';
  const AB2 = ['St', 'Dx', 'Cn', 'In', 'Ws', 'Ch', 'HS'];
  const json = (engine, code) => JSON.parse(engine.evalExpr('JSON.stringify(' + code + ')') || 'null');

  function options(engine) {
    engine.evalExpr('initiateCurrentStats(); AbilityScores_Button(true);');   // also refreshes MPMB's explanation
    const o = json(engine, '{ cols: CurrentStats.cols.map(function (c) { return { type: c.type, name: c.name, scores: c.scores.slice(0, 7), editable: !c.notUserEditable }; }),' +
      ' current: AbilityScores.abbreviations.map(function (a) { return Number(What(a)) || 0; }), names: AbilityScores.names.slice(0, 6), hos: What("HoSRememberState") || "",' +
      ' explain: Who("Str") || "", bg: CurrentBackground && CurrentBackground.name && CurrentBackground.scorestxt ? { name: CurrentBackground.name, txt: CurrentBackground.scorestxt } : null, pointBuy: [8,9,10,11,12,13,14,15].map(function (n) { return [n, Number(ASCalcPointBuy(n))]; }) }');
    // MPMB hyphenates names for its narrow dialog ("Backgr-\nound") and marks footnotes with ¹ ²
    for (const c of o.cols) c.name = c.name.replace(/-\n/g, '').replace(/\n/g, ' ').replace(/[¹²]/g, '').trim();
    o.preview = preview(engine, o.cols.map((c) => c.scores));
    return o;
  }

  // scores: one array of 7 numbers per column, in MPMB's column order
  function preview(engine, scores) {
    const res = {};
    scores.forEach((col, i) => { const n = ('0' + i).slice(-2); for (let s = 0; s < 7; s++) res[n + AB2[s]] = String(Number(col[s]) || 0); });
    return json(engine, '(function (r) { var out = []; for (var s = 0; s < 7; s++) { var t = getAbilityScoreTotals(s, r); out.push({ total: t.calculatedTotal, max: t.maximum, ongoing: t.ongoingBonus, cost: Number(ASCalcPointBuy(Number(r["00" + ["St","Dx","Cn","In","Ws","Ch","HS"][s]]))) }); } return out; })(' + JSON.stringify(res) + ')');
  }

  function apply(engine, scores) {
    const seq = engine.logSeq;
    const cur = json(engine, 'CurrentStats.cols.map(function (c) { return c.scores.slice(0, 7); })');
    const steps = [];
    scores.forEach((col, i) => {
      const n = ('0' + i).slice(-2);
      for (let s = 0; s < 7; s++) {
        const v = Number(col[s]) || 0;
        if (cur[i] && Number(cur[i][s]) === v) continue;
        steps.push({ set: { [n + AB2[s]]: String(v) } }, { press: n + AB2[s] });
      }
    });
    engine.clearQueues();
    engine.queueDialog({ name: DIALOG, steps });
    engine.action('AbilityScores_Button();', 'abilities:apply');
    engine.clearQueues();
    const { alerts, errors } = engine.logSince(seq);
    return { alerts, errors };
  }

  const api = { options, preview, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBAbilities = api;
})(typeof self !== 'undefined' ? self : this);
