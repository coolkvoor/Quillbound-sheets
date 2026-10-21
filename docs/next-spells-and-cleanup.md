# Next: spell refresh and small cleanups

A brief for a local Claude Code session (the PC has `test/sheet.pdf`, so the tests can run). Written 2026-10-21 by a cloud session that could only read the code, without the sheet: nothing below was measured. Work on the branch `ccr-5cd940c6-xkrfla` (it holds this file, on top of `master`). Delete this file in the last commit once both parts are done.

Order: part 1 and part 2 as separate commits, `npm test` and `npm run test:ui` before each push, push the branch, the owner checks the preview (`ccr-5cd940c6-xkrfla.quillbound-sheets.pages.dev`), then a pull request into `master`.

## Part 1: don't recompute the spell lists after every change

### What happens now
- `send()` in `src/app.js` (search `spellsSoon();   // class, level, feats`) calls `spellsSoon()` after **every** user change except choosing/removing spells: typing current HP, ticking a box, using an item. `tapMpmb` (after page changes) and `ui-content.js` (after content changes) call it too.
- `spellsSoon()` (`src/ui-spells.js`) waits 250 ms, then `refreshSpells()` calls the worker's `spellOptions` and `spellSheet`.
- `spellOptions` → `MPMBSpells.options()` (`src/spells.js`) runs `probe()`: MPMB's whole `AskUserSpellSheet()` with every dialog captured and cancelled, plus `SetStringifieds("spells")`, and a second probe for casters that prepare. It returns every caster's full lists (`listCa`, `listSp`, `listBo`: often hundreds of names) through postMessage.
- `probe()` writes a field (`SetStringifieds`) and normalises `CurrentSpells` (deletes `selectSp`/`selectSpSB` on whole-list casters, saves/restores `typeList`), which is why `spellOptions` isn't in the worker's `READS`: every refresh drops the worker's cached `exportState()` (`stateNow`), so the next autosave recomputes it.

For a spellcaster this is probably the most expensive thing after an ordinary tap, every time, during play. On the phone: time, battery, and the next tap waiting behind it.

### What to build
Only refresh when something that can change the spell choices changed. Suggested shape:
1. A cheap read-only worker op, e.g. `spellKey`, added to `READS`: a string that changes whenever the spell choices could. Candidates: `CurrentSpells` without the parts `probe()` itself rewrites (or computed after normalising the same way), the six ability scores and their modifiers, `Character Level`, `Proficiency Bonus`, the sources/exclusions (`CurrentSources`), the imported content (the app's `state.content`). Check what MPMB keeps in `CurrentSpells` for class, subclass, species, feats and magic items before trusting it alone (a feat or magic item that gives spells, e.g. Magic Initiate, adds a caster entry; a level up changes counts).
2. `refreshSpells()` asks for `spellKey` first and skips `spellOptions`/`spellSheet` when it matches the last one. Keep the forced refresh paths: after `chooseSpells`/`removeSpells` (they already set `state.sheet`), after content or source changes, after page changes, after opening a character (`state.spellOpts = null` in app.js resets).
3. Optional, only if (1) turns out unreliable: refresh lazily when the Spells tab or the picker opens, plus after the forced cases. The casters' counts ("choose 3 cantrips") must never show stale numbers when the user looks at them.

### How to check
- `npm test` (spells, save, classes, abilities, features, replay must stay green), `npm run test:ui`.
- Add a test (e.g. in `test/spells.test.js` or a small new one): the key stays the same after a change that can't affect spells (HP, a gear line, a condition) and changes after a level up, a new feat with spells (Magic Initiate), an ability score change for a prepared caster, a subclass that adds spells.
- Measure before/after on the PC: time `spellOptions` + `spellSheet` for the self-test Wizard 3 and a multiclass caster (`performance.now()` around the calls, or the worker's `ms`), and count how often they run while ticking HP or conditions 10 times.
- On the phone (preview): play with a Wizard (HP, conditions, items: the Spells tab stays right), level up (counts change), pick Magic Initiate (bonus spells appear).

## Part 2: small duplicates (no change in behaviour)

All covered by `npm test`; one commit.

1. **Messages since step X**: `engine.log.alerts.filter((a) => a.seq > seq)…` and the same for `errors`/`dialogs` appear in `src/abilities.js`, `src/classes.js` (twice), `src/content.js` (twice) and `src/worker.js`. `src/spells.js` already has `since(engine, seq, list)`. Make one shared helper (on the engine, e.g. `engine.logSince(seq)` returning `{ alerts, errors, dialogs }` in the shapes the callers use now) and use it everywhere. Check each caller's exact output shape (`alerts` as `{ title, msg }`, `errors` as `where + ': ' + msg`).
2. **`card(...)`** is defined three times in `src/ui-pages.js` (companion, Wild Shape, logsheet builders). One definition at the top of the file.
3. **PDF helpers** `deref`, `refKey`, `get`, `L`, `N` are defined separately in `src/loader.js`, `src/writer.js` (twice: `deref` near the top, `L` near the end) and `src/appearance.js`. They are small closures over each document's `ctx`; share them only where it reads better (e.g. a `pdfHelpers(doc)` returning them), or leave the cross-file ones and only merge the two inside `writer.js`. Remember pdf-lib must run before MPMB's scripts or in another realm (see CLAUDE.md), so don't move them into the engine.
4. **"Is this an MPMB sheet?"**: `if (names.indexOf('Startup') === -1 || !model.info.SheetVersion) throw new Error('NOT_MPMB');` is in both `open` and `prepare` in `src/worker.js`. One small function.

### Leave for later
- The attack line (To hit / Damage / Range) is built three times (`src/app.js` attacks, companion and Wild Shape in `src/ui-pages.js`) and the ability box twice (main and companion). They differ slightly per page; share them when those screens are next changed, not now.
- The `module.exports` line in 11 files is how the Node tests load them; fine as it is.

## When done
- Update CLAUDE.md where it describes what changed (the spell refresh, the shared log helper) and add a line to `docs/history.md` under the day's date.
- Delete this file.
