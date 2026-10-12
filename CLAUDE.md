# MPMB Sheet App: project notes for Claude Code

A phone-first web app (the owner's project) that opens an **MPMB 2024 (5.5e) character sheet PDF** and runs MPMB's own scripts in a stand-in for Adobe Acrobat. Users can play and build characters on a phone or tablet, with all D&D logic coming from MPMB's code inside their PDF.

- Design doc (decisions, milestones, risks): https://claude.ai/code/artifact/DESIGN-DOC
- 0.1 is published as a private Claude artifact: https://claude.ai/artifact/ARTIFACT
- Test devices: the phone (6.3", 1220×2656, about 393×852 CSS px at 3.1×) and the tablet (10.9", 1440×2304, about 800×1280 at 1.8×). Chrome on Android.

## Decisions (settled with the owner)

| Topic | Decision |
| --- | --- |
| Look | The app's own layout, phone first (PDF pages are unreadable on phones) |
| Navigation | One scrolling page per screen size + bottom tab bar that jumps to sections and follows the scroll |
| Layout | 1 column phone portrait, 2 columns phone landscape / tablet portrait, 3 columns tablet landscape |
| Save file | The MPMB PDF itself (+ autosave inside the app). Not built yet |
| Platform | Web app installed from Chrome; app stores later, if ever |
| Scope | Play **and** build characters |
| Rules | 2024 sheets first; 2014 sheets later (assumption) |

## Milestones

1. Engine in the browser. **Done in desktop Chrome tests** (self-test 19/19); waiting for the owner's phone results.
2. Main screens (Main, Combat, Features). First version is in 0.1.
3. Dialogs and menus: one renderer for MPMB's 32 dialogs (`app.execDialog`) and `app.popUpMenuEx` menus.
4. Saving back into the PDF (pdf-lib), verified by opening the result in real Acrobat.
5. Spells, inventory, notes, companion, wild shape; template page spawning.
6. Play extras (rests, slot pips), offline install.

## Files

- `src/loader.js`: reads the PDF with pdf-lib. Outputs a plain "sheet model": document scripts (name-tree order), fields, widgets, field scripts (K/F/V/C) and widget scripts (A/D/U/E/X/Fo/Bl), calculation order, templates, info dictionary, bookmarks.
- `src/engine.js`: the Acrobat stand-in. Field objects, events, `app`/`util`/doc APIs, AForm helpers, `toSource()`, templates/pages, logs.
- `src/worker.js`: one sheet per Web Worker. Its own code sits in an IIFE because the global scope belongs to MPMB.
- `src/app.js`, `src/index.html`: the screens. Fields are bound with `data-f` (input), `data-out` (formatted value), `data-rich` (MPMB rich text spans), `data-toggle` (check box), `data-items` (datalist).
- `src/selftest.js`: builds an Elf Wizard 3 and checks 19 results. Used by the app's Sheet tab and by `test/engine.test.js`.

## Build and test

- `npm install`, then put an MPMB 2024 sheet PDF at `test/sheet.pdf` (gitignored; never commit it).
- `npm test` runs the loader test (writes `test/model.json`) and the engine test. Individually:
- `node test/loader.test.js`: reads the sheet and writes `test/model.json`, which the other tests need.
- `node test/engine.test.js`: runs MPMB in a Node `vm` realm and prints the self-test results.
- `node test/debug.js 'expr' ...`: runs the self-test steps, then evaluates expressions inside the sheet's realm.
- `npx playwright install chromium` once on a new machine (the test falls back to Playwright's own Chromium).
- `node test/ui.test.js [phone-portrait|phone-landscape|tablet-portrait|tablet-landscape]`: Playwright at the real device sizes, with screenshots in `test/shots/`. Env: `SCHEME=dark`, `NOCDN=1`, `DIST=dist-single`, `URL=file:///…`.
- `tools/build.sh` → `dist/` (multi-file). `node tools/build-single.js` → `dist-single/index.html` (artifact page) and `dist-single/MPMB-Sheet-App.html` (one downloadable file; the worker starts from a blob URL).

## Acrobat fidelity: lessons learned (keep these true)

- **MPMB changes built-in prototypes.** `Array.prototype.find` is replaced (it returns an index and takes a regex), and enumerable methods are added to `Array.prototype`. Engine code must never use `Array#find` or `for…in` over arrays. pdf-lib must run before MPMB's scripts are loaded, or in another realm.
- Document-level scripts run in name-tree order with the global `event` set to a Doc/Open event (`target` = the doc). Doc properties and methods are globals (`tDoc = this`).
- **A script setting `field.value` fires that field's Validate event before storing**, then recalculates. MPMB relies on this (for example `Value("Character Level", …)` → `levelFieldVal`).
- `isBoxChecked()` returns **1/0 numbers**: MPMB compares `=== 1` (saving-throw proficiency broke with booleans).
- Text and combo box `.value` returns a Number when the text is numeric.
- MPMB needs SpiderMonkey's `toSource()` (54 uses) to store state in fields. It's polyfilled in engine.js.
- MPMB keeps state in hidden fields and in `submitName`/`userName` (for example HP Max's submitName is `"0,0,0,nothing"`, which means not automatic).
- Field objects are cached per name; MPMB sets expando properties on them (`remVal`, `setVal`, `mpmbRtFormat`).
- Calculate passes run all `C` scripts in `/CO` order; MPMB batches with `calcStop()`/`calcCont()` (`tDoc.calculate`, `tDoc.delay`).
- Rich text fields: the Format event (`formatRichText`) turns MPMB's markup into `event.richValue` spans. The app renders these spans (bold, MPMB purple → accent colour).
- JavaScript streams without a byte-order mark are UTF-8 (strict decode), falling back to PDFDocEncoding.
- `/CO` contains 57 stale parent references; the loader keeps only fields that have a `C` script.

## Known gaps in 0.1

- **Dialogs are auto-answered** with the values the dialog loads itself (initialize → commit → "ok"). Effects:
  - Elf lineage isn't chosen, so Racial Traits stays empty.
  - The Level box opens MPMB's class selection dialog, so levelling up currently means typing "Wizard 4" into the Class field.
  - Subclass, feats and ASI choices are impossible for now.
- Real dialogs need the engine to wait synchronously for the user. The plan is the worker + `Atomics.wait`, which needs cross-origin isolation (COOP/COEP headers). Claude artifacts can't send headers, so milestone 3 needs real hosting (GitHub Pages + coi-serviceworker, or Cloudflare Pages `_headers`).
- Menus (`app.popUpMenuEx`) return null. Nothing is saved yet. Template spawning is basic and untested.
- `util.readFileIntoStream()` returns null; hooking it to a file picker is the route for "Add Extra Materials" (book import).

## Working safely on the owner's PC

- the owner's rule: **work freely inside this project folder, but never touch anything outside it without asking him first**, including reading, writing, deleting, installing globally or changing system settings.
- `.claude/settings.json` starts sessions in Accept edits mode. File edits and file commands inside the folder run without prompts; anything outside the folder prompts. The project's own commands are pre-approved (`npm install`, `npm test`, `npm run …`, `git add`, `git commit`). Destructive git commands are blocked.
- Use the npm scripts rather than ad-hoc commands: `npm test`, `npm run test:ui`, `npm run build`.
- Never delete or overwrite `test/sheet.pdf` (the owner's own sheet). Commit before larger changes so everything can be rolled back.

## Copyright and publishing rules

- Never commit or bundle MPMB PDFs, MPMB's code, or add-on book scripts. Users bring their own. Non-SRD content belongs to Wizards of the Coast; MPMB's code is GPL-3.0 by Joost Wijnen.
- Keep "MPMB" out of a public app name ("works with MPMB sheets" is fine). Contact Joost (mpmb@flapkan.com, MPMB Discord) before publishing.
- The Claude artifact publisher rejects raw U+FFFD characters: the builds escape them in pdf-lib.
