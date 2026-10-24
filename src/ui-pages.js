/* Quillbound Sheets — the extra pages: companion, wild shape, notes and adventure logsheet pages. Shares helpers and state with the other screen files through window.MPMBUI (ui-core.js). */
(() => {
  'use strict';
  const U = window.MPMBUI;
  const { $, $$, el, typingIn, state, rows, ABILITIES, SKILLS, BOUND } = U;
  // from the other screen files (all loaded before anything runs)
  const picture = (...a) => U.picture(...a);
  const lineMenu = (...a) => U.lineMenu(...a);
  const modInput = (...a) => U.modInput(...a);
  const buildIndex = (...a) => U.buildIndex(...a);
  const apply = (...a) => U.apply(...a);
  const layoutGrids = (...a) => U.layoutGrids(...a);
  const refreshDerived = (...a) => U.refreshDerived(...a);

  // ---------------------------------------------------------------- companion pages
  // One set of cards per companion page in the PDF. A page's fields carry its prefix ("P4.AScomp."), from the worker's
  // pageList. The first page is in the PDF as distributed; MPMB's Companion Options menu adds and removes pages.
  const COMP_ATTACKS = 3, COMP_GEAR = 24;
  let compPrefixes = [];
  const fid = (name) => 'f-' + name.replace(/\W+/g, '-');
  const cInput = (field, label, attrs) => el('label', { cls: 'f' }, [el('span', { text: label }), el('input', Object.assign({ cls: 'in', 'data-f': field, id: fid(field), autocomplete: 'off' }, attrs || {}))]);
  // a drop-down whose options are the combo box's own items (value: export value, text: what the sheet shows)
  // a card with a heading (a string, or an h3 with buttons in it)
  const card = (title, kids, attrs) => el('div', Object.assign({ cls: 'card' }, attrs || {}), [typeof title === 'string' ? el('h3', { text: title }) : title].concat(kids));
  const cSelect = (field, label) => el('select', { cls: 'in', 'data-f': field, 'data-opts': field, id: fid(field), 'aria-label': label });
  // the prefixes of a template's pages ("P4.AScomp.") in the worker's pageList
  const pagePrefixes = (list, key) => { const p = (list || []).filter((x) => x.key === key)[0]; return p ? p.prefixes : []; };
  // one set of cards per page of a template, rebuilt in `box` when MPMB adds or removes pages; then the app watches
  // every field the cards bind (plus `extra`) and fills them. grids: false for pages without card grids (Notes).
  async function rebuildPages(box, prefixes, build, extra, grids) {
    box.textContent = '';
    prefixes.forEach((P, i) => box.append(build(P, i + 1, prefixes.length)));
    buildIndex();
    const names = new Set(extra || []);
    for (const n of box.querySelectorAll(BOUND.map((a) => '[' + a + ']').join(','))) for (const a of BOUND) if (n.hasAttribute(a)) names.add(n.getAttribute(a));
    if (names.size) { const snaps = await state.worker.call('watch', { names: Array.from(names) }); for (const s of snaps) apply(s); }
    if (grids !== false) layoutGrids(true, Array.from(box.querySelectorAll('.grid')));
    refreshDerived();
  }
  const cText = (field, label, rows) => el('label', { cls: 'f', 'data-vis': field, hidden: '' }, [el('span', { text: label }), el('textarea', { cls: 'in', rows: String(rows || 4), 'data-f': field, id: fid(field) })]);
  function buildCompanion(P, n, total) {
    const U = P + 'Comp.Use.';
    const grid = el('div', { cls: 'grid' });
    const opts = el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Companion.Options', 'data-title': 'Companion options', 'data-pages': '1' }, [document.createTextNode('Options')]);
    // the creature: MPMB fills in the whole page from its list
    grid.append(card(el('h3', {}, [el('span', { 'data-compname': P, text: 'Companion' }), opts]), [
      cInput(P + 'Comp.Desc.Name', 'Name'),
      el('label', { cls: 'f' }, [el('span', { text: 'Creature' }), el('input', { cls: 'in', 'data-f': P + 'Comp.Race', id: fid(P + 'Comp.Race'), list: 'dl-' + fid(P + 'race'), autocomplete: 'off', placeholder: 'Pick or type a creature' }), el('datalist', { id: 'dl-' + fid(P + 'race'), 'data-items': P + 'Comp.Race' })]),
      el('p', { cls: 'hint', text: 'MPMB fills in the page from the creature you pick. Options has familiars (Find Familiar, Pact of the Chain), the sections shown, and adding or removing companion pages.' }),
      el('div', { cls: 'row' }, [
        el('label', { cls: 'f' }, [el('span', { text: 'Kind' }), cSelect(P + 'Comp.Type', 'Kind of companion')]),
        el('label', { cls: 'f' }, [el('span', { text: 'Size' }), cSelect(P + 'Comp.Desc.Size', 'Size')]),
      ]),
      el('div', { cls: 'row' }, [
        el('label', { cls: 'f' }, [el('span', { text: 'Type' }), cSelect(P + 'Comp.Desc.MonsterType', 'Creature type')]),
        el('label', { cls: 'f' }, [el('span', { text: 'Alignment' }), cSelect(P + 'Comp.Desc.Alignment', 'Alignment')]),
      ]),
      el('details', { cls: 'more' }, [el('summary', { text: 'Description' }), el('div', { cls: 'row' }, [
        cInput(P + 'Comp.Desc.Sex', 'Sex'), cInput(P + 'Comp.Desc.Age', 'Age'), cInput(P + 'Comp.Desc.Height', 'Height'), cInput(P + 'Comp.Desc.Weight', 'Weight'),
      ])]),
      el('div', { cls: 'pics' }, [picture(P + 'Comp.img.Portrait', 'Companion picture', 245, 151, 'one')]),
    ]));
    // abilities, saves, defense
    const abis = el('div', { cls: 'abilities' });
    for (const [k, long] of ABILITIES) {
      const A = U + 'Ability.' + k + '.';
      abis.append(el('div', { cls: 'abi' }, [
        el('span', { cls: 'k', text: k.toUpperCase(), title: long }),
        el('span', { cls: 'mod num', 'data-out': A + 'Mod', text: '–' }),
        el('input', { 'data-f': A + 'Score', id: fid(A + 'Score'), inputmode: 'numeric', autocomplete: 'off', 'aria-label': long + ' score', cls: 'num' }),
        el('div', { cls: 'save' }, [
          el('button', { cls: 'dot sm', type: 'button', 'data-toggle': A + 'ST.Prof', 'aria-pressed': 'false', 'aria-label': long + ' saving throw proficiency' }),
          el('span', { text: 'Save ' }), el('b', { cls: 'num', 'data-out': A + 'ST.Mod', text: '–' }),
        ]),
      ]));
    }
    grid.append(card('Stats', [
      el('div', { cls: 'stats' }, [
        el('div', { cls: 'stat big' }, [el('span', { cls: 'k', text: 'Armor Class' }), el('span', { cls: 'v num', 'data-out': U + 'AC', text: '–' })]),
        el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Initiative' }), el('span', { cls: 'v num', 'data-out': U + 'Combat.Init.Mod', text: '–' })]),
        el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Proficiency' }), el('span', { cls: 'v num', 'data-out': U + 'Proficiency Bonus', text: '–' })]),
        el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Passive Perc.' }), el('span', { cls: 'v num', 'data-out': U + 'Skills.Perc.Pass.Mod', text: '–' })]),
      ]),
      el('div', { cls: 'row-ad' }, [el('span', { cls: 'muted', text: 'Initiative rolls' }), el('span', { cls: 'ad' }, [
        el('button', { type: 'button', 'data-toggle': U + 'Initiative.Adv', 'aria-pressed': 'false', 'aria-label': 'Initiative: advantage', title: 'Advantage', text: 'A' }),
        el('button', { type: 'button', 'data-toggle': U + 'Initiative.Dis', 'aria-pressed': 'false', 'aria-label': 'Initiative: disadvantage', title: 'Disadvantage', text: 'D' }),
      ])]),
      el('div', { cls: 'row' }, [cInput(U + 'AC', 'Armor Class'), cInput(U + 'Speed', 'Speed'), cInput(U + 'Combat.Init.Bonus', 'Initiative bonus', { cls: 'in num', inputmode: 'text' })]),
      cInput(U + 'Senses', 'Senses'),
      abis,
    ]));
    // hit points: current, max (MPMB's Set menu), temporary, hit dice, death saves; Long rest is MPMB's heal button
    const dots = (kind, label) => el('div', { cls: 'grp' }, [el('span', { cls: 'lbl', text: label })].concat([1, 2, 3].map((i) =>
      el('button', { cls: 'dot sm', type: 'button', 'data-toggle': U + 'DeathSave.' + kind + '.' + i, 'aria-pressed': 'false', 'aria-label': 'Death save ' + label.toLowerCase().replace(/s$/, '') + ' ' + i }))));
    grid.append(card(el('h3', {}, [el('span', { text: 'Hit points' }), el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Comp.Heal', 'data-title': 'Long rest', 'data-done': 'Long rest: hit points and death saves reset, half the hit dice back.' }, [document.createTextNode('Long rest')])]), [
      el('div', { cls: 'hp' }, [
        el('button', { cls: 'btn', type: 'button', 'data-step': U + 'HP.Current', 'data-by': '-1', 'aria-label': 'Lose 1 hit point', text: '−' }),
        el('input', { cls: 'in num', 'data-f': U + 'HP.Current', id: fid(U + 'HP.Current'), inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Current hit points' }),
        el('button', { cls: 'btn', type: 'button', 'data-step': U + 'HP.Current', 'data-by': '1', 'aria-label': 'Gain 1 hit point', text: '+' }),
      ]),
      el('div', { cls: 'row' }, [
        el('div', { cls: 'f' }, [el('span', { cls: 'flabel' }, [document.createTextNode('Max '), el('button', { cls: 'linkish', type: 'button', 'data-mpmb': P + 'Buttons.Comp.Use.HP.Max', 'data-title': 'Max HP', text: 'Set' })]),
          el('input', { cls: 'in num', 'data-f': U + 'HP.Max', id: fid(U + 'HP.Max'), inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Max hit points' })]),
        cInput(U + 'HP.Temp', 'Temporary', { inputmode: 'numeric', cls: 'in num' }),
      ]),
      el('div', { cls: 'row three' }, [
        cInput(U + 'HD.Level', 'Hit dice', { inputmode: 'numeric', cls: 'in num' }),
        cInput(U + 'HD.Die', 'Die', { inputmode: 'numeric', cls: 'in num' }),
        cInput(U + 'HD.Used', 'Used', { inputmode: 'numeric', cls: 'in num' }),
      ]),
      el('p', { cls: 'hint' }, [document.createTextNode('Constitution adds '), el('b', { cls: 'num', 'data-out': U + 'HD.Con' }), document.createTextNode(' per hit die.')]),
      el('div', { cls: 'deaths' }, [dots('Success', 'Successes'), dots('Fail', 'Failures')]),
    ]));
    // skills: MPMB's skill name button cycles not proficient → proficient → expertise
    const skills = el('div', { cls: 'skills two' });
    for (const [f, name, abi] of SKILLS) {
      skills.append(el('div', { cls: 'skill' }, [
        el('button', { cls: 'dot sm', type: 'button', 'data-mpmb': P + 'Text.Comp.Use.Skills.' + f + '.Name', 'data-prof': P + 'Text.Comp.Use.Skills.' + f + '.Prof', 'data-title': name, 'aria-pressed': 'false', 'aria-label': name + ' proficiency' }),
        el('span', { cls: 'n', text: name }), el('span', { cls: 'a', text: abi }),
        el('span', { cls: 'v num', 'data-out': U + 'Skills.' + f + '.Mod', text: '–' }),
      ]));
    }
    grid.append(card('Skills', [el('p', { cls: 'hint', text: 'Tap a dot for proficiency, again for expertise, a third time to clear.' }), skills], { 'data-span': '2' }));
    // attacks
    const atks = el('div', {}, [el('datalist', { id: 'dl-' + fid(P + 'atk'), 'data-items': U + 'Attack.1.Weapon Selection' })]);
    for (let i = 1; i <= rows('compAttacks', COMP_ATTACKS); i++) {
      const p = U + 'Attack.' + i + '.';
      atks.append(el('div', { cls: 'attack', 'data-cattack': p }, [
        el('div', { cls: 'line' }, [
          el('label', { cls: 'f' }, [el('span', { text: 'Attack ' + i }), el('input', { cls: 'in', 'data-f': p + 'Weapon Selection', id: fid(p + 'Weapon Selection'), list: 'dl-' + fid(P + 'atk'), autocomplete: 'off', placeholder: 'Pick or type an attack' })]),
          lineMenu(U + 'Attack.Button.' + i, 'Attack ' + i),
        ]),
        el('div', { cls: 'figs', 'data-figs': '1' }, [
          el('span', {}, [el('span', { cls: 'muted', text: 'To hit ' }), el('b', { 'data-out': p + 'To Hit', text: '–' })]),
          el('span', {}, [el('span', { cls: 'muted', text: 'Damage ' }), el('b', { 'data-out': p + 'Damage', text: '–' }), el('span', { text: ' ' }), el('span', { 'data-out': p + 'Damage Type', text: '' })]),
          el('span', {}, [el('span', { cls: 'muted', text: 'Range ' }), el('b', { 'data-out': p + 'Range', text: '–' })]),
        ]),
        el('div', { cls: 'desc', 'data-out': p + 'Description', 'data-figs': '1', text: '' }),
        el('div', { cls: 'atk-set', 'data-figs': '1' }, [
          el('span', { cls: 'tg' }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': p + 'Proficiency', 'aria-pressed': 'false', 'aria-label': 'Attack ' + i + ' proficiency' }), el('span', { text: 'Proficient' })]),
          el('label', { cls: 'f inline' }, [el('span', { text: 'Ability' }), cSelect(p + 'Mod', 'Attack ' + i + ' ability')]),
        ]),
        el('div', { cls: 'row atk-mods', 'data-vis': P + 'BlueText.Comp.Use.Attack.' + i + '.To Hit Bonus', hidden: '' }, [
          modInput(P + 'BlueText.Comp.Use.Attack.' + i + '.To Hit Bonus', 'To hit +'),
          modInput(P + 'BlueText.Comp.Use.Attack.' + i + '.Damage Bonus', 'Damage +'),
          modInput(P + 'BlueText.Comp.Use.Attack.' + i + '.Damage Die', 'Damage die'),
        ]),
      ]));
    }
    grid.append(card('Attacks', [el('div', { cls: 'row-ad' }, [el('label', { cls: 'f inline' }, [el('span', { text: 'Attacks per action' }), el('input', { cls: 'in num', 'data-f': U + 'Attack.perAction', id: fid(U + 'Attack.perAction'), inputmode: 'numeric', autocomplete: 'off' })])]), atks], { 'data-span': '2' }));
    // traits and features as MPMB formats them, with the text to edit underneath
    const richBox = (field, label) => el('div', { cls: 'stack' }, [
      el('span', { cls: 'lbl', text: label }), el('div', { cls: 'rich', 'data-rich': field, 'data-empty': 'None' }),
      el('details', { cls: 'more' }, [el('summary', { text: 'Edit ' + label.toLowerCase() }), el('textarea', { cls: 'in', rows: '6', 'data-f': field, id: fid(field), 'aria-label': label })]),
    ]);
    grid.append(card('Traits and features', [richBox(U + 'Traits', 'Traits'), richBox(U + 'Features', 'Features')]));
    // MPMB's modifier ("blue text") fields for the companion, shown when MPMB shows them (Functions → Modifiers)
    const B = P + 'BlueText.Comp.Use.';
    const mgroup = (title, items) => el('div', { cls: 'mods-group' }, [el('span', { cls: 'lbl', text: title }), el('div', { cls: 'mods-grid' }, items.map(([f, l]) => modInput(f, l)))]);
    grid.append(card('Modifiers', [
      el('p', { cls: 'hint', text: 'MPMB adds these to its own calculations for the companion. Type a number, or an ability such as Wis.' }),
      el('span', { cls: 'tg' }, [el('button', { cls: 'dot sm', type: 'button', 'data-toggle': B + 'Proficiency Bonus Dice', 'aria-pressed': 'false', 'aria-label': 'Proficiency dice' }), el('span', { text: 'Proficiency dice' })]),
      mgroup('General', [[B + 'Skills.All.Bonus', 'All skills'], [B + 'Ability.All.ST.Bonus', 'All saves'], [B + 'Skills.Perc.Pass.Bonus', 'Passive Perc.']]),
      mgroup('Saving throws', ABILITIES.map(([k, long]) => [B + 'Ability.' + k + '.ST.Bonus', long])),
      mgroup('Skills', SKILLS.map(([f, name]) => [B + 'Skills.' + f + '.Bonus', name])),
    ], { 'data-span': '2', 'data-vis': B + 'Skills.Acr.Bonus', hidden: '' }));
    // equipment (MPMB can hide this section: Options → Change visible sections)
    const gear = el('div', {}, [el('div', { cls: 'gear-head' }, [el('span', { text: 'Item' }), el('span', { text: 'Amount' }), el('span', { text: 'Weight' }), el('span')])]);
    for (let i = 1; i <= rows('compGear', COMP_GEAR); i++) {
      const g = P + 'Comp.eqp.Gear ';
      gear.append(el('div', { cls: 'gear-row', 'data-cgear': g + 'Row ' + i }, [
        el('input', { cls: 'in', 'data-f': g + 'Row ' + i, id: fid(g + 'Row ' + i), autocomplete: 'off', placeholder: 'Add an item', 'aria-label': 'Item ' + i }),
        el('input', { cls: 'in num', 'data-f': g + 'Amount ' + i, id: fid(g + 'Amount ' + i), inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Amount' }),
        el('input', { cls: 'in num', 'data-f': g + 'Weight ' + i, id: fid(g + 'Weight ' + i), inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Weight' }),
        lineMenu(P + 'Comp.eqpB.Button ' + i, 'Item ' + i),
      ]));
    }
    grid.append(card('Equipment', [gear], { 'data-span': '2', 'data-vis': P + 'Comp.eqp.Gear Row 1', hidden: '' }));
    // notes: the page's notes columns and the boxes MPMB shows in place of a hidden section
    grid.append(card(el('h3', {}, [el('span', { text: 'Notes' }), el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Cnote.Options', 'data-title': 'Notes options' }, [document.createTextNode('Options')])]), [
      cText(P + 'Cnote.Left', 'Notes', 8), cText(P + 'Cnote.Right', 'More notes', 8),
      cText(P + 'Comp.img.Notes', 'Appearance', 4), cText(P + 'Comp.eqp.Notes', 'Notes (in place of equipment)', 6),
    ]));
    for (const c of grid.children) if (c.dataset.span) c.classList.add('span-2');
    // with more than one companion, a heading per companion
    const head = total > 1 ? [el('h3', { cls: 'comp-title' }, [el('span', { 'data-compname': P, text: 'Companion' }), el('span', { cls: 'chip', text: n + ' of ' + total })])] : [];
    return el('div', { cls: 'comp', 'data-comp': P }, head.concat([grid]));
  }
  // build (or rebuild) the companion cards when the companion pages change, and watch their fields
  async function syncCompanions(list) {
    const prefixes = pagePrefixes(list, 'AScomp');
    // no companion page: no band and no tab (Sheet → Pages → Change adds one again). Before the check below: a character
    // reopened without one has nothing to rebuild, but the band is still shown from the last one.
    $('#companion').hidden = !prefixes.length;
    $('#tab-companion').hidden = !prefixes.length;
    if (JSON.stringify(prefixes) === JSON.stringify(compPrefixes) && $('#comp-list').childElementCount === prefixes.length) return;
    compPrefixes = prefixes.slice();
    await rebuildPages($('#comp-list'), prefixes, buildCompanion, prefixes.map((P) => P + 'Comp.Use.Ability.Str.Mod'));
  }
  function refreshCompanions(v) {
    for (const h of $$('[data-compname]')) {
      const P = h.dataset.compname;
      h.textContent = v(P + 'Comp.Desc.Name') || v(P + 'Comp.Race') || 'Companion';
    }
    // attacks and equipment: the filled lines plus the first empty one
    for (const comp of $$('[data-comp]')) {
      let first = true;
      for (const row of comp.querySelectorAll('[data-cattack]')) {
        const has = v(row.dataset.cattack + 'Weapon Selection') !== '' || typingIn(row);
        row.hidden = !has && !first;
        for (const x of row.querySelectorAll('[data-figs]')) x.hidden = !has;
        row.querySelector('.more').hidden = !has;
        if (!has) first = false;
      }
      first = true;
      for (const row of comp.querySelectorAll('[data-cgear]')) {
        const has = v(row.dataset.cgear) !== '' || typingIn(row);
        row.hidden = !has && !first;
        row.querySelector('.more').hidden = !has;
        if (!has) first = false;
      }
    }
  }

  // ---------------------------------------------------------------- wild shape pages
  // MPMB's Wild Shapes page (template WSfront): four shapes per page, each worked out by MPMB from the creature picked
  // in its Wildshape.Race.N box, plus the page's Wild Shape details (copies of MPMB's Wildshapes.Info fields). The
  // page's Settings menu adds and removes shapes (limited to what the character can take), recalculates and adds
  // or removes pages. The PDF as distributed has none; the band shows once there is a page or MPMB has given the
  // character Wild Shape.
  const WS_PER_PAGE = 4, WS_ATTACKS = 2, WS_BLANK = 'make a selection';
  let wsPrefixes = [];
  function buildWildShapePage(P, n, total) {
    const grid = el('div', { cls: 'grid' });
    const I = P + 'Wildshapes.Info.';
    grid.append(card(el('h3', {}, [el('span', { text: 'Wild Shape' }), el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Wildshapes.Settings', 'data-title': 'Wild Shapes', 'data-pages': '1' }, [document.createTextNode('Options')])]), [
      el('p', { cls: 'hint', text: 'Options → Add Wild Shape lists the beasts this character can take; MPMB works out each shape with your own proficiencies. It also removes shapes, recalculates them (after a level up) and adds or removes Wild Shapes pages.' }),
      // 2024 sheets: known forms and temp HP; 2014 sheets: uses (the one the sheet doesn't have is left out)
      el('div', { cls: 'row' }, [cInput(I + 'KnownForms', 'Known forms'), cInput(I + 'TempHP', 'Temp HP', { inputmode: 'numeric', cls: 'in num' }), cInput(I + 'Uses', 'Uses')]),
      cInput(I + 'Limitations', 'Limitations'),
      cInput(I + 'Duration', 'Duration'),
    ]));
    for (let i = 1; i <= rows('ws', WS_PER_PAGE); i++) {
      const W = P + 'Wildshape.' + i + '.', T = P + 'Text.Wildshape.' + i + '.Skills.', race = P + 'Wildshape.Race.' + i;
      const body = el('div', { cls: 'stack', 'data-wsbody': '1' });
      body.append(
        el('div', { cls: 'row' }, [
          el('label', { cls: 'f' }, [el('span', { text: 'Type' }), cSelect(W + 'MonsterType', 'Creature type')]),
          el('label', { cls: 'f' }, [el('span', { text: 'Size' }), cSelect(W + 'Size', 'Size')]),
        ]),
        el('div', { cls: 'row' }, [cInput(W + 'CR', 'Challenge'), cInput(W + 'HD', 'Hit dice')]),
        el('div', { cls: 'stats' }, [
          el('div', { cls: 'stat big' }, [el('span', { cls: 'k', text: 'Armor Class' }), el('span', { cls: 'v num', 'data-out': W + 'AC', text: '–' })]),
          el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Initiative' }), el('span', { cls: 'v num', 'data-out': W + 'Initiative Bonus', text: '–' })]),
          el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Proficiency' }), el('span', { cls: 'v num', 'data-out': W + 'Proficiency Bonus', text: '–' })]),
          el('div', { cls: 'stat' }, [el('span', { cls: 'k', text: 'Passive Perc.' }), el('span', { cls: 'v num', 'data-out': W + 'Skills.PassPerc', text: '–' })]),
        ]),
        cInput(W + 'Speed', 'Speed'),
        el('div', { cls: 'row three' }, [
          cInput(W + 'HP Temp', 'Temp HP', { inputmode: 'numeric', cls: 'in num' }),
          cInput(W + 'HP Current', 'Current HP', { inputmode: 'numeric', cls: 'in num' }),
          cInput(W + 'HP Max', 'Max HP', { inputmode: 'numeric', cls: 'in num' }),
        ]),
      );
      const abis = el('div', { cls: 'abilities' });
      for (const [k, long] of ABILITIES) {
        const A = W + 'Ability.' + k + '.';
        abis.append(el('div', { cls: 'abi' }, [
          el('span', { cls: 'k', text: k.toUpperCase(), title: long }),
          el('span', { cls: 'mod num', 'data-out': A + 'Mod', text: '–' }),
          el('input', { 'data-f': A + 'Score', id: fid(A + 'Score'), inputmode: 'numeric', autocomplete: 'off', 'aria-label': long + ' score', cls: 'num' }),
          el('div', { cls: 'save' }, [
            el('button', { cls: 'dot sm', type: 'button', 'data-toggle': A + 'ST.Prof', 'aria-pressed': 'false', 'aria-label': long + ' saving throw proficiency' }),
            el('span', { text: 'Save ' }), el('b', { cls: 'num', 'data-out': A + 'ST.Mod', text: '–' }),
          ]),
        ]));
      }
      body.append(abis);
      // skills: the proficient ones in the summary, all of them (with MPMB's proficiency buttons) folded
      const skills = el('div', { cls: 'skills two' });
      for (const [f, name, abi] of SKILLS) {
        skills.append(el('div', { cls: 'skill' }, [
          el('button', { cls: 'dot sm', type: 'button', 'data-mpmb': T + f + '.Name', 'data-prof': T + f + '.Prof', 'data-title': name, 'aria-pressed': 'false', 'aria-label': name + ' proficiency' }),
          el('span', { cls: 'n', text: name }), el('span', { cls: 'a', text: abi }),
          el('input', { cls: 'v num in-v', 'data-f': W + 'Skills.' + f, id: fid(W + 'Skills.' + f), inputmode: 'numeric', autocomplete: 'off', 'aria-label': name }),
          // the Printer Friendly sheets instead: proficiency and expertise boxes and the number in ".Mod" (the set the
          // sheet doesn't have is left out)
          el('button', { cls: 'dot sm', type: 'button', 'data-toggle': W + 'Skills.' + f + '.Prof', 'aria-pressed': 'false', 'aria-label': name + ' proficiency' }),
          el('button', { cls: 'dot sm', type: 'button', 'data-toggle': W + 'Skills.' + f + '.Exp', 'aria-pressed': 'false', 'aria-label': name + ' expertise', title: 'Expertise' }),
          el('input', { cls: 'v num in-v', 'data-f': W + 'Skills.' + f + '.Mod', id: fid(W + 'Skills.' + f + '.Mod'), inputmode: 'numeric', autocomplete: 'off', 'aria-label': name }),
        ]));
      }
      body.append(el('details', { cls: 'more' }, [el('summary', {}, [document.createTextNode('Skills '), el('span', { cls: 'muted', 'data-wsskills': W })]),
        el('p', { cls: 'hint', text: 'MPMB works these out when the shape is added. A dot marks proficiency (tap again for expertise, a third time to clear; Printer Friendly sheets have a second dot for expertise) but, as on the PDF, doesn’t change the number: type it in.' }), skills]));
      // attacks as MPMB worked them out, editable underneath
      for (let a = 1; a <= rows('wsAttacks', WS_ATTACKS); a++) {
        const p = W + 'Attack.' + a + '.';
        body.append(el('div', { cls: 'attack', 'data-wsattack': p }, [
          el('b', { 'data-out': p + 'Weapon' }),
          el('div', { cls: 'figs' }, [
            el('span', {}, [el('span', { cls: 'muted', text: 'To hit ' }), el('b', { 'data-out': p + 'To Hit', text: '–' })]),
            el('span', {}, [el('span', { cls: 'muted', text: 'Damage ' }), el('b', { 'data-out': p + 'Damage', text: '–' }), el('span', { text: ' ' }), el('span', { 'data-out': p + 'Damage Type', text: '' })]),
            el('span', {}, [el('span', { cls: 'muted', text: 'Range ' }), el('b', { 'data-out': p + 'Range', text: '–' })]),
          ]),
          el('div', { cls: 'desc', 'data-out': p + 'Description', text: '' }),
        ]));
      }
      const edits = [];
      for (let a = 1; a <= rows('wsAttacks', WS_ATTACKS); a++) {
        const p = W + 'Attack.' + a + '.';
        edits.push(el('div', { cls: 'stack' }, [
          cInput(p + 'Weapon', 'Attack ' + a),
          el('div', { cls: 'row three' }, [cInput(p + 'To Hit', 'To hit'), cInput(p + 'Damage', 'Damage'), cInput(p + 'Range', 'Range')]),
          el('label', { cls: 'f' }, [el('span', { text: 'Damage type' }), el('input', { cls: 'in', 'data-f': p + 'Damage Type', id: fid(p + 'Damage Type'), list: 'dl-' + fid(p + 'Damage Type'), autocomplete: 'off' }), el('datalist', { id: 'dl-' + fid(p + 'Damage Type'), 'data-items': p + 'Damage Type' })]),
          cInput(p + 'Description', 'Description'),
        ]));
      }
      body.append(el('details', { cls: 'more' }, [el('summary', { text: 'Edit attacks' })].concat(edits)));
      // traits as MPMB formats them (senses, special abilities)
      body.append(el('div', { cls: 'stack' }, [
        el('span', { cls: 'lbl', text: 'Traits' }), el('div', { cls: 'rich', 'data-rich': W + 'Traits', 'data-empty': 'None' }),
        el('details', { cls: 'more' }, [el('summary', { text: 'Edit traits' }), el('textarea', { cls: 'in', rows: '6', 'data-f': W + 'Traits', id: fid(W + 'Traits'), 'aria-label': 'Traits' })]),
      ]));
      grid.append(card(el('h3', {}, [el('span', { 'data-wsname': race, text: 'Shape ' + i }), el('span', { cls: 'chip', 'data-wscr': W + 'CR', hidden: '' })]), [
        el('label', { cls: 'f' }, [el('span', { text: 'Creature' }), el('input', { cls: 'in', 'data-f': race, 'data-blank': WS_BLANK, id: fid(race), list: 'dl-' + fid(race), autocomplete: 'off', placeholder: 'Pick or type a beast' }), el('datalist', { id: 'dl-' + fid(race), 'data-items': race })]),
        body,
      ], { 'data-ws': race }));
    }
    const head = total > 1 ? [el('h3', { cls: 'comp-title' }, [el('span', { text: 'Wild Shapes page' }), el('span', { cls: 'chip', text: n + ' of ' + total })])] : [];
    return el('div', { cls: 'comp', 'data-wspage': P }, head.concat([grid]));
  }
  // build (or rebuild) the wild shape cards when the Wild Shapes pages change, and watch their fields
  async function syncWildShapes(list) {
    const prefixes = pagePrefixes(list, 'WSfront');
    if (JSON.stringify(prefixes) === JSON.stringify(wsPrefixes) && $('#ws-list').childElementCount === prefixes.length) return;
    wsPrefixes = prefixes.slice();
    await rebuildPages($('#ws-list'), prefixes, buildWildShapePage);
  }
  function refreshWildShapes(v) {
    const band = $('#wildshape');
    // the band: shown with a Wild Shapes page, or when MPMB has given the character Wild Shape (its known forms)
    const has = wsPrefixes.length > 0, known = v('Wildshapes.Info.KnownForms') !== '' || v('Wildshapes.Info.Uses') !== '';
    const show = has || known;
    if (band.hidden === show) { band.hidden = !show; $('#tab-wildshape').hidden = !show; }
    $('#ws-none').hidden = has;
    $('#ws-add').hidden = has;
    // shapes: the picked ones plus the first empty one per page
    const changed = [];
    for (const page of $$('[data-wspage]')) {
      let first = true;
      for (const c of page.querySelectorAll('[data-ws]')) {
        const r = v(c.dataset.ws), picked = r !== '' && r.toLowerCase() !== WS_BLANK;
        const hide = !picked && !first && !typingIn(c);
        if (c.hidden !== hide) { c.hidden = hide; if (changed.indexOf(page) === -1) changed.push(page); }
        c.querySelector('[data-wsbody]').hidden = !picked;
        const name = c.querySelector('[data-wsname]');
        name.textContent = picked ? r : 'Add a shape';
        const cr = c.querySelector('[data-wscr]'), crv = v(cr.dataset.wscr);
        cr.textContent = 'CR ' + crv; cr.hidden = !picked || !crv;
        // an attack line without a name stays out of sight
        for (const a of c.querySelectorAll('[data-wsattack]')) a.hidden = v(a.dataset.wsattack + 'Weapon') === '';
        if (!picked) first = false;
      }
    }
    for (const s of $$('[data-wsskills]')) {
      const W = s.dataset.wsskills, T = W.replace(/Wildshape\.(\d+)\.$/, 'Text.Wildshape.$1.Skills.');
      const box = (n) => !!(state.snap.get(n) || {}).checked;   // Printer Friendly: Prof / Exp boxes and ".Mod"
      const prof = SKILLS.filter(([f]) => { const x = v(T + f + '.Prof'); return x === 'proficient' || x === 'expertise' || box(W + 'Skills.' + f + '.Prof') || box(W + 'Skills.' + f + '.Exp'); })
        .map(([f, name]) => name + ' ' + (v(W + 'Skills.' + f) || v(W + 'Skills.' + f + '.Mod')));
      s.textContent = prof.length ? '(' + prof.join(', ') + ')' : '';
    }
    if (changed.length) layoutGrids(true, changed.map((pg) => pg.querySelector('.grid')));
  }

  // ---------------------------------------------------------------- notes pages
  // MPMB's Notes pages (template ASnotes; the PDF as distributed has one): two columns each, and the page's Options
  // button (lines on or off per column, add a page, remove this one)
  let notesPrefixes = null;
  function buildNotesPage(P, i, total) {
    const n = total > 1 ? ' ' + i : '';
    return el('div', { cls: 'stack', 'data-notespage': P }, [
      el('div', { cls: 'row' }, [el('span', { cls: 'lbl grow', text: 'Notes page' + n }),
        el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Notes.Options', 'data-title': 'Notes page' + n, 'data-pages': '1' }, [document.createTextNode('Options')])]),
      el('label', { cls: 'f' }, [el('span', { text: 'Left column' }), el('textarea', { cls: 'in', rows: '6', 'data-f': P + 'Notes.Left', id: fid(P + 'Notes.Left') })]),
      el('label', { cls: 'f' }, [el('span', { text: 'Right column' }), el('textarea', { cls: 'in', rows: '6', 'data-f': P + 'Notes.Right', id: fid(P + 'Notes.Right') })]),
    ]);
  }
  async function syncNotes(list) {
    const prefixes = pagePrefixes(list, 'ASnotes');
    $('#notes-add').hidden = prefixes.length > 0;
    if (notesPrefixes && JSON.stringify(prefixes) === JSON.stringify(notesPrefixes)) return;
    notesPrefixes = prefixes.slice();
    await rebuildPages($('#notes-pages'), prefixes, buildNotesPage, null, false);
  }

  // ---------------------------------------------------------------- adventure logsheet pages
  // MPMB's Adventurers League logsheet (template ALlog, from Adventurers League → Show Adventure Logsheet(s)): seven
  // entries per page, each with XP, gold, downtime, renown and magic items as start + gain = total (MPMB carries a
  // total into the next entry's start), and the session's details. The page's Options menu adds and removes pages,
  // generates the next entry and sets the date format; an entry's menu moves, inserts, deletes or clears it.
  const LOG_PER_PAGE = 7;
  const LOG_COUNTS = [['xp', 'XP'], ['gold', 'Gold'], ['downtime', 'Downtime'], ['renown', 'Renown'], ['magicItems', 'Magic items']];
  let logPrefixes = [];
  function buildLogPage(P, n, total) {
    const grid = el('div', { cls: 'grid' });
    grid.append(card(el('h3', {}, [el('span', { text: 'Logsheet' }), el('span', { cls: 'chip', 'data-out': P + 'AdvLog.sheetNumber', text: '' }),
      el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'AdvLog.Options', 'data-title': 'Logsheet options', 'data-pages': '1' }, [document.createTextNode('Options')])]), [
      el('p', { cls: 'hint', text: 'One entry per session. Options → Generate next Logsheet Entry starts the next one from the totals; Options also sets the date format and adds or removes logsheet pages. An entry’s ⋯ button moves, inserts, deletes or clears it.' }),
    ]));
    for (let i = 1; i <= rows('log', LOG_PER_PAGE); i++) {
      const E = P + 'AdvLog.' + i + '.';
      const counts = el('div', { cls: 'log-counts' }, [el('span', {}), el('span', { cls: 'k', text: 'Start' }), el('span', { cls: 'k', text: '+ / −' }), el('span', { cls: 'k', text: 'Total' })]);
      for (const [k, label] of LOG_COUNTS) {
        counts.append(el('span', { cls: 'lbl', text: label }),
          el('input', { cls: 'in num', 'data-f': E + k + '.start', id: fid(E + k + '.start'), inputmode: 'decimal', autocomplete: 'off', 'aria-label': label + ' at the start' }),
          el('input', { cls: 'in num', 'data-f': E + k + '.gain', id: fid(E + k + '.gain'), autocomplete: 'off', 'aria-label': label + ' gained or lost' }),
          el('b', { cls: 'num', 'data-out': E + k + '.total', text: '–' }));
      }
      grid.append(card(el('h3', {}, [el('span', { 'data-logname': E, text: 'Entry ' + i }),
        el('button', { cls: 'btn sm', type: 'button', 'data-mpmb': P + 'Button.AdvLog.' + i, 'data-title': 'Logsheet entry', 'aria-label': 'Entry ' + i + ' menu' }, [document.createTextNode('⋯')])]), [
        el('div', { cls: 'row' }, [cInput(E + 'date', 'Date'), cInput(E + 'session', 'Session')]),
        cInput(E + 'adventure', 'Adventure'),
        cInput(E + 'dm', 'DM (name and DCI)'),
        counts,
        el('div', { cls: 'stack' }, [
          el('span', { cls: 'lbl', text: 'Notes' }), el('div', { cls: 'rich', 'data-rich': E + 'notes', 'data-empty': 'None' }),
          el('details', { cls: 'more' }, [el('summary', { text: 'Edit notes' }), el('textarea', { cls: 'in', rows: '5', 'data-f': E + 'notes', id: fid(E + 'notes'), 'aria-label': 'Notes' })]),
        ]),
      ], { 'data-log': E }));
    }
    const head = total > 1 ? [el('h3', { cls: 'comp-title' }, [el('span', { text: 'Logsheet page' }), el('span', { cls: 'chip', text: n + ' of ' + total })])] : [];
    return el('div', { cls: 'comp', 'data-logpage': P }, head.concat([grid]));
  }
  async function syncLogs(list) {
    const prefixes = pagePrefixes(list, 'ALlog');
    if (JSON.stringify(prefixes) === JSON.stringify(logPrefixes) && $('#log-list').childElementCount === prefixes.length) return;
    logPrefixes = prefixes.slice();
    await rebuildPages($('#log-list'), prefixes, buildLogPage);
  }
  function refreshLogs(v) {
    const show = logPrefixes.length > 0;
    const band = $('#advlog');
    if (band.hidden === show) { band.hidden = !show; $('#tab-advlog').hidden = !show; }
    // entries: the used ones plus the first empty one per page
    const changed = [];
    for (const page of $$('[data-logpage]')) {
      let first = true;
      for (const c of page.querySelectorAll('[data-log]')) {
        const E = c.dataset.log;
        const used = ['date', 'adventure', 'session', 'dm', 'notes', 'xp.gain', 'gold.gain', 'downtime.gain', 'renown.gain', 'magicItems.gain'].some((k) => v(E + k) !== '');
        const hide = !used && !first && !typingIn(c);
        if (c.hidden !== hide) { c.hidden = hide; if (changed.indexOf(page) === -1) changed.push(page); }
        const name = c.querySelector('[data-logname]');
        const title = [v(E + 'adventure'), v(E + 'date')].filter((x) => x !== '').join(' · ');
        name.textContent = used ? title || 'Entry ' + E.replace(/^.*AdvLog\.(\d+)\.$/, '$1') : 'New entry';
        if (!used) first = false;
      }
    }
    if (changed.length) layoutGrids(true, changed.map((pg) => pg.querySelector('.grid')));
  }
  // a new sheet: no companion or wild shape cards yet
  function clearPageCards() { compPrefixes = []; $('#comp-list').textContent = ''; wsPrefixes = []; $('#ws-list').textContent = ''; }

  Object.assign(U, {
    refreshCompanions, refreshWildShapes, refreshLogs, syncCompanions, syncWildShapes, syncLogs, syncNotes,
    clearPageCards
  });
})();
