// MPMB's Adventurers League options (Functions > Adventurers League): the menu, each option on and off, "Prepare the
// sheet for Adventurers League play", the faction picked from the list (symbol and rank list, as in Acrobat), the
// Adventure Logsheet page (totals carried into the next entry, its Options and entry menus), then save and restore
// and the PDF read back as a new sheet.
const fs = require('fs'), path = require('path'), vm = require('vm');
const PDFLib = require('pdf-lib');
const SRC = path.join(__dirname, '..', 'src');
const { load } = require(path.join(SRC, 'loader.js'));
const { write } = require(path.join(SRC, 'writer.js'));
const selftest = require(path.join(SRC, 'selftest.js'));
const content = require(path.join(SRC, 'content.js'));
const engineSrc = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
function newEngine(modelJSON, state) {
  const ctx = vm.createContext({ __modelJSON: modelJSON });
  const evalGlobal = (code, name) => vm.runInContext(code, ctx, { filename: name || 'eval' });
  evalGlobal(engineSrc, 'engine.js');
  ctx.__host = { global: ctx, evalGlobal };
  const engine = evalGlobal('MPMBEngine.createEngine(JSON.parse(__modelJSON), __host, { fileName: "sheet.pdf" })');
  if (state) engine.importState(JSON.parse(JSON.stringify(state)));
  engine.start();
  content.restore(engine);
  engine.drainChanges();
  return engine;
}
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(50), detail === undefined ? '' : String(detail).slice(0, 200)); };
const find = (items, re) => { for (const i of items || []) { if (i.items) { const f = find(i.items, re); if (f) return f; } else if (re.test(i.ret)) return i; } return null; };

(async () => {
  const modelJSON = fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8');
  const e = newEngine(modelJSON);
  for (const [op, f, v] of selftest.steps) e[op](f, v);
  e.commit('PC Name', 'Ilvara');
  e.drainChanges();
  const shown = (eng, n) => { const s = eng.snapshot(n); return s.exists && !s.hidden; };
  const val = (eng, n) => String(eng.snapshot(n).value);
  // a button or bookmark with a menu: run it once for the menu, then with the choice (and yes/no answers) queued
  function tap(eng, where, ret, yes) {
    eng.clearQueues();
    if (ret) eng.queueMenu(ret);
    if (yes !== undefined) eng.queueAnswer(yes);
    if (Array.isArray(where)) eng.runBookmark(where); else eng.press(where, 0);
    const m = eng.takeMenu(); eng.clearQueues(); return m;
  }
  const AL = ['Functions', 'Adventurers League'];

  let menu = tap(e, AL);
  check('menu lists the AL options', ['hp', 'dci', 'factionrank', 'encumbrance', 'allog', 'all#1'].every((k) => find(menu, new RegExp('^advleague#' + k))), menu && menu.map((i) => i.ret).join(' '));

  // one option at a time
  tap(e, AL, 'advleague#dci#1');
  check('DCI field shown', shown(e, 'DCI.Text'));
  tap(e, AL, 'advleague#dci#0');
  check('…and hidden again', !shown(e, 'DCI.Text'));
  tap(e, AL, 'advleague#hp#1');
  check('HP set to fixed values', e.evalExpr('tDoc.getField("HP Max").submitName.split(",")[3]') === 'fixed', e.evalExpr('tDoc.getField("HP Max").submitName'));

  // everything at once
  tap(e, AL, find(menu, /^advleague#all#1/).ret);
  check('Prepare for AL: DCI, faction, rank and renown shown', ['DCI.Text', 'Background_Faction.Text', 'Background_FactionRank.Text', 'Background_Renown.Text'].every((n) => shown(e, n)));
  const pages = () => String(e.evalExpr('What("Template.extras.ALlog")')).split(',').slice(1);
  check('Prepare for AL: a logsheet page', pages().length === 1, pages().join(' '));
  menu = tap(e, AL);
  check('the menu marks what is on', ['hp', 'dci', 'factionrank', 'allog'].every((k) => { const i = find(menu, new RegExp('^advleague#' + k + '#')); return i && i.marked; }));
  check('no errors so far', e.log.errors.length === 0, JSON.stringify(e.log.errors.slice(0, 2)));

  // the faction from its list: MPMB sets the symbol and the faction's ranks
  e.commit('Background_Faction.Text', 'The Harpers');
  const ranks = e.snapshot('Background_FactionRank.Text').items || [];
  check('faction picked', /harpers/i.test(val(e, 'Background_Faction.Text')), val(e, 'Background_Faction.Text'));
  check('the rank list has the Harpers ranks', ranks.length > 2, JSON.stringify(ranks).slice(0, 160));
  const sym = e.snapshot('Symbol');
  check('the symbol is the Harpers symbol', sym.icon === 'fld:SaveIMG.Faction.harpers.symbol', sym.icon);
  e.commit('Background_FactionRank.Text', String((ranks[1] && (ranks[1][0] || ranks[1].name || ranks[1])) || ''));
  e.commit('Background_Renown.Text', '3');
  e.commit('DCI.Text', '1234567890');

  // the logsheet: totals carried into the next entry
  const P = pages()[0], L = P + 'AdvLog.';
  e.commit(L + '1.date', '2026-10-20'); e.commit(L + '1.adventure', 'DDEX1-1'); e.commit(L + '1.xp.start', '900'); e.commit(L + '1.xp.gain', '1200'); e.commit(L + '1.gold.gain', '75');
  e.commit(L + '1.notes', 'Met the **Harpers**');
  check('entry 1: XP total', Number(val(e, L + '1.xp.total')) === 2100, val(e, L + '1.xp.total'));
  check('entry 2 starts from it', Number(val(e, L + '2.xp.start')) === 2100 && Number(val(e, L + '2.gold.start')) === 75, val(e, L + '2.xp.start') + ' / ' + val(e, L + '2.gold.start'));
  check('the page copies name and DCI', val(e, P + 'AdvLog.PC Name') === 'Ilvara' && val(e, P + 'AdvLog.DCI.Text') === '1234567890', val(e, P + 'AdvLog.PC Name') + ' / ' + val(e, P + 'AdvLog.DCI.Text'));
  // Options → Generate next Logsheet Entry
  let m = tap(e, P + 'AdvLog.Options');
  const gen = find(m, /generate$/);
  check('Options menu', !!gen && !!find(m, /add page$/) && !!find(m, /^dateformat#/), m && m.map((i) => i.name).filter((x) => x !== '-').join(' | '));
  tap(e, P + 'AdvLog.Options', gen.ret);
  check('Generate next entry fills its date', val(e, L + '2.date') !== '', val(e, L + '2.date'));
  // an entry's menu: insert an empty one above entry 1, then delete it again
  m = tap(e, P + 'Button.AdvLog.1');
  check('entry menu', !!find(m, /insert$/) && !!find(m, /delete$/), m && m.map((i) => i.name).filter((x) => x !== '-').join(' | '));
  tap(e, P + 'Button.AdvLog.1', find(m, /insert$/).ret);
  check('Insert: entry 1 moves down', val(e, L + '2.adventure') === 'DDEX1-1' && val(e, L + '1.adventure') === '', JSON.stringify([val(e, L + '1.adventure'), val(e, L + '2.adventure')]));
  m = tap(e, P + 'Button.AdvLog.1');
  tap(e, P + 'Button.AdvLog.1', find(m, /delete$/).ret, true);
  check('Delete: it moves back up', val(e, L + '1.adventure') === 'DDEX1-1', val(e, L + '1.adventure'));
  // MPMB moves the gains, dates and notes only: the first entry's typed start went with Insert (doAdvLogLine), as in Acrobat
  check('the typed start of entry 1 is cleared by Insert (MPMB)', val(e, L + '1.xp.start') === '' && Number(val(e, L + '1.xp.total')) === 1200, val(e, L + '1.xp.start'));
  e.commit(L + '1.xp.start', '900');
  const errs = e.log.errors.filter((x) => !/countDecimals/.test(x.msg));   // MPMB's format2 bug, also in Acrobat
  check('no errors (besides MPMB format2)', errs.length === 0, JSON.stringify(errs.slice(0, 2)));

  // save and restore
  const state = e.exportState();
  const r = newEngine(modelJSON, state);
  const rp = String(r.evalExpr('What("Template.extras.ALlog")')).split(',').slice(1);
  check('restore: logsheet page, entry, faction, DCI', rp[0] === P && val(r, L + '1.adventure') === 'DDEX1-1' && Number(val(r, L + '2.xp.start')) === 2100
    && /harpers/i.test(val(r, 'Background_Faction.Text')) && shown(r, 'DCI.Text') && val(r, 'DCI.Text') === '1234567890', [rp.join(' '), val(r, L + '1.adventure'), val(r, L + '2.xp.start'), val(r, 'Background_Faction.Text'), shown(r, 'DCI.Text'), val(r, 'DCI.Text')].join(' | '));
  check('restore: the symbol stays', r.snapshot('Symbol').icon === 'fld:SaveIMG.Faction.harpers.symbol', r.snapshot('Symbol').icon);

  // into the PDF and back as a new sheet
  const bytes = fs.readFileSync((process.env.SHEET || path.join(__dirname, 'sheet.pdf')));
  state.look = e.appearanceData(Object.keys(state.fields));
  const out = await write(new Uint8Array(bytes), state, PDFLib);
  const model2 = await load(out.bytes, PDFLib);
  const e2 = newEngine(JSON.stringify(model2));
  const p2 = String(e2.evalExpr('What("Template.extras.ALlog")')).split(',').slice(1);
  check('PDF: logsheet page and entries', p2[0] === P && val(e2, L + '1.adventure') === 'DDEX1-1' && Number(val(e2, L + '1.xp.total')) === 2100, p2.join(' ') + ' ' + val(e2, L + '1.xp.total'));
  check('PDF: AL fields shown and filled', shown(e2, 'DCI.Text') && shown(e2, 'Background_Renown.Text') && val(e2, 'Background_Renown.Text') === '3');

  // undo everything: MPMB asks before removing the logsheet
  tap(e, AL, find(tap(e, AL), /^advleague#all#0/).ret, true);
  check('Undo all: fields hidden, logsheet removed', !shown(e, 'DCI.Text') && !shown(e, 'Background_Faction.Text') && pages().length === 0, pages().join(' '));

  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
