# Quillbound Sheets: build history

How the app came to be the way it is: the timeline, how decisions were reached, and the longer stories behind the fixes. Moved out of `CLAUDE.md` on 2026-10-21 so sessions don't load it every time. `CLAUDE.md` has the rules that hold now; read this when you need to know *why* something is the way it is, or when it happened. The commit log has the full detail (`git log`).

## Timeline

### 2026-10-12: version 0.1
- The loader, the engine (a stand-in for Acrobat's JavaScript), phone and tablet screens, and a self-test (an Elf Wizard 3, 19 checks) in a single day.
- Single-file build: the engine worker starts from a blob URL; the worker keeps its own code out of the global scope (MPMB owns it).
- Add-on content (import files, paste scripts, choose sources, kept per sheet); spells (picker, list, slots); MPMB's menus (species options, Choose Feature, Max HP, rests); the Gear tab with line menus; MPMB's text dialogs and modifier fields; autosave; Download PDF; class selection and ability scores on the app's own screens.
- Project safety settings: Accept edits inside the project, prompts outside it, destructive git commands blocked.
- Test builds were published as a Claude artifact (pdf-lib from cdnjs), the "0.2 test build".

### 2026-10-13 to 10-15
- XP with Level up, conditions and exhaustion, ammunition, notes, the background page.
- Class features and species traits as a list. Found the line-break bug (see "Stories" below); old saves need the class removed and added again, and the app spots such text and offers "Rebuild feature texts".
- Cards in fixed columns; `npm start` serves the current build, never cached.
- Spells: class lists with a switch per spell, search and filter bar, A–Z, spellbooks over 20 spells kept.
- Menus explain greyed-out choices (skill proficiency, requirements, class level, Warlock cantrip upgrades).
- Tools and languages can be typed in.

### 2026-10-18
- Many front-page fields: advantage/disadvantage marks, save DCs, AC parts, resistances, attack proficiency and ability, attacks per action, extra equipment, feat notes, hit dice.
- `src/features.js` parser: a short feature's description on its heading line (it said "No description"); `test/features.test.js` levels every class and subclass 1–20, each class in its own process with a time limit.
- `localeCompare` sorting as Acrobat does (Weapon Mastery menu order).
- Set Pages Layout and the list of extra pages; MPMB's yes/no questions in buttons and bookmarks asked before anything changes.

### 2026-10-19: dialogs, looks, pictures, the PDF in Acrobat
- Safety net for MPMB's Notes hang: a request past its time limit restarts the engine from the autosave, with "Clear out Notes pages".
- Companion screen (one set of cards per companion page), Wild Shape screen.
- **MPMB's dialogs shown to the user.** First version: the worker waits with `Atomics.wait` (needs a cross-origin isolated page). A QuickJS (WebAssembly) prototype was tried as a way to pause MPMB for dialogs without special hosting; then **restart and replay** was built, which works everywhere at full speed, and dialogs worked in every build that evening. The QuickJS prototype was removed on 10-21.
- `dist-site/` built for the app's own web address (Cloudflare Pages with COOP/COEP in `_headers`).
- Five looks after MPMB's Colorful and Printer Friendly sheets, plus "Match my sheet".
- Pictures both ways (portrait, symbol, companion picture).
- **The saved PDF checked in real Acrobat (version 40): it works completely** (milestone 4). It first showed MPMB's markup; the writer now draws the field appearances itself (see "Stories").

### 2026-10-20: settings, installable app, 2014 sheets, the name
- Self-test card removed from the app (kept in the Node tests).
- Second-page fields, Text Options checked end to end, Adventurers League (menu, faction, logsheet pages), Notes pages, modifier switches, the optional 7th ability (Honor/Sanity).
- `src/app.js` split into `ui-core.js`, the `ui-*.js` area files and `app.js`, without changing behaviour.
- Direct Import between two sheets ("Import from another sheet").
- The four 2014 (v14) sheets work: MPMB's code needed nothing; the app counts lines per sheet and leaves out fields a sheet lacks.
- Cloudflare Pages went live behind Cloudflare Access; the Settings panel in the top bar.
- Shipping changed from publishing a Claude artifact (versions up to 53) to `git push` to `master`; the artifact was retired.
- Installable app (manifest, icons, offline service worker), the dialogs switch in Settings (MPMB waits, or restart and replay), the downloadable file carries pdf.js.
- The site contacts no other address (fonts and pdf.js served by the site, a strict CSP). Settings → Backups.
- Sources: exclude single items with MPMB's own selection dialogs.
- Update bar when a new version is out while the app is open.
- Named **Quillbound**, then **Quillbound Sheets** after finding a web game called Quillbound at quillbound.pages.dev (no trademark check yet). Version 1.0; the build time is no longer shown (the owner's wish). The repo and Pages project were renamed to match.
- Credits and licences in Settings; personal details moved out of the repo into `CLAUDE.local.md`.

### 2026-10-21
- QuickJS prototype removed; the app licensed under GPL-3.0-or-later.
- Text boxes grow with their text. Versions 1.1 and 1.1.1 (the patch number shows when it isn't 0).
- README with the site's address. The site was briefly made public, then kept **private behind Cloudflare Access until Joost (MPMB's author) has looked at it**; preview builds of branches need the wildcard rule too.
- Spells: "Ritual" and "Needs sight" tags instead of MPMB's tiny marks.
- Code cleanup on a branch: one list of user changes (the worker sends `USER_OPS` to the page), one rebuild function for the four page types.
- Backups in Brave (no folder access): Save a copy, then send or download it.
- MPMB's superscript source marks in dialog lists ("Paladin ˢʳᵈ'²⁴") showed as a jumble of fallback fonts on the phone; now a small-caps label.
- `CLAUDE.md` cleaned up; this file holds what was taken out.

### 2026-10-22
- Spells: the app re-ran MPMB's whole spell dialog (`spellOptions`, 35 ms for a Wizard 3 and 63 ms for a three-class caster on the PC, more on the phone) after every change, HP and conditions included, and each run dropped the worker's cached state, so the next autosave worked it out again. Now a spell key (`spellKey`, 0.2 ms) decides; ten HP changes run no spell probe at all.
- Every tap sent the page about 2 MB once the spell options had run: the log summary carried the spell dialog's captured lists (about 1 MB per caster). The page now gets only each dialog's name, title and answer (2 KB), and spells.js and classes.js take the captured data out of the log after reading it (the log keeps 200 entries, which could have held 200 MB).
- A saved PDF whose character once had a second companion page didn't work in Acrobat (no bookmark or button did anything): removing the page had left 138 empty field nodes. The writer now removes emptied parents, and its `removeField` (which never found its node) works.
- A stress-test character (four classes, add-on content, every extra page) showed the app couldn't open a saved PDF holding add-on content: pdf-lib decodes a text value with one function argument per character, and the 1 MB content file overflowed the stack. The loader now decodes long values in pieces.
- Small duplicates merged: `engine.logSince(seq)` for "what MPMB said since step n", one `card()` in ui-pages.js, one "is this an MPMB sheet?" check in the worker. The PDF helpers (`deref`, `get`, `L`…) stay per file: each is a one-line closure over its own document.

### 2026-10-30: Sources on its own screen (1.5.0)
- Joost (MPMB) tried the one-file build on his phone: including sources was a hassle, the list was very long with no clear start or end, and there was no "include all". With his `all_WotC_2024_published` file the book list is short (4 books), but it marks 19 items (firearms, explosives, their ammunition) as left out by default, which only the single-item dialogs include. There the move buttons were `>>`, `>`, `<`, `<<` beside stacked lists (">>" is include all, which nobody would guess), and the Included list scrolled inside the scrolling dialog with no count and no end in sight.
- Tested on the 2014 Colorful A4 sheet with a made-up file of 60 books in four groups: the Sources card was 6,182 px (7 phone screens), a group heading was drawn each time the group changed (books come in file order), every tick ran a full Apply with all boxes locked, and the "added" message named all 60 books. MPMB itself needs 50–100 ms in Node for any number of books.
- Now: Sources is a full-screen panel from a book in the top bar (the owner's choice over a bottom-bar item: the bar holds up to nine tabs). The save chip became a round mark on phones so the name keeps its width (163 px at 393 px, as before). Books fold per group (478 px for the same 63 books), with Include all / Exclude all; ticks never lock. The dialogs name the move buttons and give long lists a search box and a count.

- The tour: the owner rated the list of things to explain (long tour for people new to the sheet, short for people who know it; Looks in the short one), asked that a thing the character doesn't have still be shown where it would be, that steps inside Settings or Sources wait for the user's own tap, and for short, plain texts. 29 steps in the full tour, 18 in the quick one.
- The tour got a sample character (the owner's idea, with "make sure the character data on the sheet remains"): a second copy of the sheet with a made-up Wizard 3, nothing stored meanwhile. Checked on the owner's 2024 character: the saved character is the same before, during and after the tour and after a reload mid-tour. The first try started the sample from the user's PDF and showed their Cleric's spell list: a saved PDF holds the character, so the sample resets it first; MPMB's own reset failed halfway on a sheet with a class (`classes.primary` left set, see the MPMB bugs in CLAUDE.md).
- A long name ("Alinar Brightshield") was still cut off on the phone: the busy dot now sits on the save mark's corner.

## Milestones (as planned on day one)

1. Engine in the browser. Done in desktop Chrome tests (self-test 19/19); phone results still to come.
2. Main screens (Main, Combat, Features). First version in 0.1.
3. Dialogs and menus: one renderer for MPMB's 32 dialogs and its menus. Done 10-19, working everywhere (waiting where the page is isolated, restart and replay elsewhere).
4. Saving back into the PDF, verified in real Acrobat. Done 10-19 (Acrobat version 40).
5. Spells, inventory, notes, companion, wild shape, template pages. Built by 10-19/10-20.
6. Play extras (rests, slot pips) and offline install. Installable app built 10-20; not yet tried on the phone.

## How some decisions came about

- **Hosting.** Dialogs first needed a cross-origin isolated page (so MPMB can wait), which a Claude artifact or a downloaded file can't be. Restart and replay removed that need, so hosting became optional; Cloudflare Pages was set up anyway, with COOP/COEP, so the page can also wait. For a while the app shipped as a Claude artifact (versions up to 53) before moving to `git push` to `master`.
- **Privacy of the site.** Behind Cloudflare Access from the start (10-20), the manifest link got `crossorigin="use-credentials"` and the service worker learned to pass a login redirect through without keeping it. Made public on 10-21, then private again the same day, pending MPMB's author.
- **The name.** "MPMB Sheet App" → "Quillbound" → "Quillbound Sheets" (10-20). Storage names (`mpmb-sheet-app`, `mpmb-*`) were kept so saved characters survive.
- **PDF page view for tablets.** Considered and dropped: the app's own layout is the decision, and Acrobat shows the real sheet.
- **QuickJS.** Tried on 10-19 as a way to pause MPMB's code for dialogs; restart and replay did the job in plain JavaScript, so it was removed on 10-21.

## Stories behind the Acrobat lessons

The rules themselves are in `CLAUDE.md` ("Acrobat fidelity"). These are the longer accounts of how they were found.

- **Line breaks (10-13).** With LF left in text fields, MPMB couldn't find a class feature's section (it splits on CR), so every new feature went in under the previous heading and the descriptions piled up at the end in reverse order. Acrobat stores CR; the engine does now. Characters saved before the fix keep the bunched text until the class is removed and added again; `staleClassText` spots it.
- **"No description" (10-18).** Short features keep their whole description on the heading line, often in plain brackets (`[Adv on Initiative]`); the app showed "No description." until `src/features.js`.
- **MPMB's markup in Acrobat (10-19).** A PDF saved by the app showed "#◆ Spellcasting#" and "**Druid…**" in Acrobat. The writer had set NeedAppearances, and Acrobat redraws before MPMB's scripts load, so MPMB's Format scripts never ran; a document script redrawing the fields afterwards (`password = false`) didn't help. The writer now draws the changed fields itself (`src/appearance.js`). An earlier attempt left a `zzMPMBSheetApp` document script in saved PDFs; the engine skips it and the writer removes it.
- **Saving-throw proficiency** broke while `isBoxChecked()` returned booleans: MPMB compares `=== 1`.
- **Species ignored after a change.** Picking Human after Infernal Tiefling did nothing: MPMB parks the new text in `field.setVal`, and only the field's Validate clears it, which the engine didn't run for calculated values yet.
- **Small read back as Medium.** Size Category's items share an export value; the picked index (`/I`) wasn't kept.
- **Magic Initiate picks lost.** MPMB's spell dialog stores picks only in its `ok` handler, which queued answers skipped.
- **Empty spell sheets.** Every generated spell sheet came out empty until `insertEntryInList`/`removeAllEntriesFromList` worked in dialogs.
- **Spellbooks over 20 spells.** The next save dropped everything after the 20th spell, and the prepared spells among them, until `selectSpSB` was read too.
- **Cleric/Paladin prepare lists empty.** MPMB took any `selectSp`, even `[]`, as a spellbook.
- **Text Options fonts dropped.** "Standard font" stayed on because radios weren't exclusive when a handler loaded one, and commit reads the first radio that is on.
- **Faction symbol not set.** MPMB's faction box reads only `changeEx` from the non-commit keystroke Acrobat sends when an item is picked.
- **Every skill's Adv and Dis ticked** after a reset or import: `checkThisBox(n, 0)` must uncheck (MPMB passes 0 for "neither"), which made passive Perception +5.
- **"10 FT SPEED" labels empty** after a reset: a Calculate that sets `richValue` must set the value to the spans' text.
- **New page's calculated fields empty.** MPMB restarts calculations from a timer (`calcStop` → `app.setTimeOut(calcCont)`), and only engine actions run pending timeouts, so MPMB functions must run through `engine.action`.
- **The Notes hang.** Found while testing: `AddToNotes` loops forever when removing a feature whose text is on the 3rd+ Notes page (Acrobat too). Led to the time limits and the "Clear out Notes pages" recovery.
- **Late `<dialog>` close events.** In a background page Chrome delivered none until it rendered; a late one could answer the next question, so the Yes/No box and menus answer from their buttons.
- **Features test looping.** One sheet reused for ~40 subclasses with the WotC content ended up looping inside MPMB, hence one fresh sheet per class with a 300 s limit.
