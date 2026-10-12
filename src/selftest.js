/* Self-test: builds a level 3 Elf Wizard from a blank sheet and checks MPMB's results.
 * Shared by the app (runs in its own engine) and the Node tests. */
(function (root) {
  'use strict';
  const steps = [
    ['commit', 'Str', '8'], ['commit', 'Dex', '14'], ['commit', 'Con', '14'],
    ['commit', 'Int', '16'], ['commit', 'Wis', '12'], ['commit', 'Cha', '10'],
    ['commit', 'Race', 'Elf'],
    ['commit', 'Class and Levels', 'Wizard 3'],
    ['commit', 'AC Armor Description', 'Unarmored'],
    ['commit', 'Attack.1.Weapon Selection', 'Quarterstaff'],
    ['commit', 'Attack.2.Weapon Selection', 'Fire Bolt'],
  ];
  // [label, field, expected value (string) or RegExp]
  const checks = [
    ['Character level', 'Character Level', '3'],
    ['Strength modifier', 'Str Mod', '-1'],
    ['Intelligence modifier', 'Int Mod', '3'],
    ['Proficiency bonus', 'Proficiency Bonus', '2'],
    ['Intelligence save (proficient)', 'Int ST Mod', '5'],
    ['Strength save', 'Str ST Mod', '-1'],
    ['Arcana (Int, not proficient)', 'Arc', '3'],
    ['Initiative', 'Initiative bonus', '2'],
    ['Speed', 'Speed', /30 ft/],
    ['Darkvision', 'Vision', /Darkvision 60 ft/],
    ['Elf save traits', 'Saving Throw advantages / disadvantages', /Charmed/],
    ['1st-level spell slots', 'SpellSlots.CheckboxesSet.lvl1', '4'],
    ['Class features', 'Class Features', /Arcane Recovery/],
    ['Limited feature', 'Limited Feature 1', /Arcane Recovery/],
    ['Unarmored AC', 'AC', '12'],
    ['Quarterstaff to hit', 'Attack.1.To Hit', /^\+?1$/],
    ['Quarterstaff damage', 'Attack.1.Damage', '1d6-1'],
    ['Fire Bolt to hit', 'Attack.2.To Hit', /^\+?5$/],
    ['Fire Bolt range', 'Attack.2.Range', /120 ft/],
  ];
  function evaluate(get) {
    return checks.map(([label, field, exp]) => {
      const v = get(field);
      const value = v === undefined || v === null ? '' : String(v);
      const ok = exp instanceof RegExp ? exp.test(value) : value === exp;
      return { label, field, expected: String(exp), value: value.length > 120 ? value.slice(0, 117) + '…' : value, ok };
    });
  }
  const api = { steps, checks, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBSelfTest = api;
})(typeof self !== 'undefined' ? self : this);
