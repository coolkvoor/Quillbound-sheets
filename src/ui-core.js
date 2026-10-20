/* Quillbound Sheets — what the screen files share: helpers, the app's lists and its state, in window.MPMBUI.
   Loaded first; then ui-*.js (each adds its functions to MPMBUI), then app.js, which starts the app. */
(() => {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const el = (tag, attrs, kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'cls') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach((c) => n.append(c));
    return n;
  };
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ABILITIES = [['Str', 'Strength'], ['Dex', 'Dexterity'], ['Con', 'Constitution'], ['Int', 'Intelligence'], ['Wis', 'Wisdom'], ['Cha', 'Charisma']];
  const SKILLS = [['Acr', 'Acrobatics', 'Dex'], ['Ani', 'Animal Handling', 'Wis'], ['Arc', 'Arcana', 'Int'], ['Ath', 'Athletics', 'Str'], ['Dec', 'Deception', 'Cha'], ['His', 'History', 'Int'], ['Ins', 'Insight', 'Wis'], ['Inti', 'Intimidation', 'Cha'], ['Inv', 'Investigation', 'Int'], ['Med', 'Medicine', 'Wis'], ['Nat', 'Nature', 'Int'], ['Perc', 'Perception', 'Wis'], ['Perf', 'Performance', 'Cha'], ['Pers', 'Persuasion', 'Cha'], ['Rel', 'Religion', 'Int'], ['Sle', 'Sleight of Hand', 'Dex'], ['Ste', 'Stealth', 'Dex'], ['Sur', 'Survival', 'Wis']];
  const ATTACKS = 6, LIMITED = 8, FEATS = 5, HITDICE = 3;
  // suggestions for the language lines (the 2024 standard and rare languages); MPMB has no list of them
  const LANGUAGES = ['Common', 'Common Sign Language', 'Draconic', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc',
    'Abyssal', 'Celestial', 'Deep Speech', 'Druidic', 'Infernal', 'Primordial', 'Sylvan', 'Thieves’ Cant', 'Undercommon'];
  const ACTIONS = [['Action', 16, 'Action'], ['Bonus Action', 6, 'Bonus action'], ['Reaction', 6, 'Reaction']];

  // content: what MPMB has loaded (files, pasted script, sources); saved: the fields that hold it, kept per sheet
  const state = { worker: null, bytes: null, fileName: '', sheetKey: '', snap: new Map(), info: null, stats: null, log: null, busy: 0, content: null, saved: null };
  const LEVEL_NAMES = ['Cantrips', '1st level', '2nd level', '3rd level', '4th level', '5th level', '6th level', '7th level', '8th level', '9th level'];
  // the attributes that bind an element to an MPMB field (data-mpmb: one of MPMB's buttons, shown when MPMB shows it)
  // data-vis: shown only while MPMB shows that field (its modifier fields, for example)
  // data-opts: a drop-down filled with the combo box's items; data-prof: a skill dot for a not/proficient/expertise box
  // data-pick: a drop-down of a combo box's items by position, for items that share an export value (Size Category)
  // data-icon: the picture one of MPMB's buttons shows (portrait, symbol, companion)
  const BOUND = ['data-f', 'data-out', 'data-rich', 'data-toggle', 'data-items', 'data-mpmb', 'data-vis', 'data-opts', 'data-prof', 'data-pick', 'data-icon'];

  // how many lines of a kind the app shows: its own number, but never more than this sheet has (the sheets differ:
  // Printer Friendly and Letter have fewer attacks, feats, actions and gear lines than Colorful A4). state.rowCounts
  // comes from the worker's open (ROWS in worker.js), counted from the sheet's own fields.
  const rows = (key, n) => { const c = state.rowCounts && state.rowCounts[key]; return typeof c === 'number' ? Math.min(n, c) : n; };

  window.MPMBUI = {
    $, $$, el, reduceMotion, state, rows, ABILITIES, SKILLS, BOUND, LEVEL_NAMES, HITDICE, ATTACKS, LIMITED, FEATS,
    ACTIONS, LANGUAGES
  };
})();
