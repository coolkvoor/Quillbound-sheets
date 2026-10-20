# Quillbound Sheets

Works with MPMB character sheets (not made by MPMB). Phone-first web app that opens an MPMB 2024 character sheet PDF and runs the sheet's own scripts in a stand-in for Acrobat.

- `src/loader.js` reads the PDF (pdf-lib): scripts, fields, calculation order, templates, bookmarks.
- `src/engine.js` the Acrobat stand-in (fields, events, app/util/doc APIs) that MPMB's code runs against.
- `src/worker.js` runs one sheet per Web Worker (MPMB changes built-in prototypes, so it gets its own realm).
- `src/app.js`, `src/index.html` the screens.
- `src/selftest.js` the Elf Wizard 3 check, used by the app and `test/engine.test.js`.

Build: `tools/build.sh` → `dist/`. Tests: put an MPMB sheet at `test/sheet.pdf`, run `node test/loader.test.js` (writes `test/model.json`), `node test/engine.test.js`, `node test/ui.test.js`.

No MPMB code or book content is included; users bring their own sheet.

## Credits and licences

Quillbound Sheets is an independent app, not made, endorsed or supported by Wizards of the Coast or by MorePurpleMoreBetter (MPMB). Settings → Credits and licences in the app shows all of this, including the open sheet's own SRD attribution statement.

- Rules content comes from the user's sheet. MPMB's sheets include material from the System Reference Document (SRD 5.2.1 on 2024 sheets, SRD 5.1 on 2014 sheets) by Wizards of the Coast LLC, licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode).
- The rules automation is MPMB's own code from the user's sheet: MorePurpleMoreBetter's Character Record Sheets by Joost Wijnen (https://flapkan.com), GPL-3.0. None of it is in this repository.
- Bundled in the builds: pdf-lib (copyright 2019 Andrew Dillon, MIT), PDF.js (Mozilla Foundation, Apache 2.0), Alegreya SC and Alegreya Sans (The Alegreya Project Authors, SIL Open Font License 1.1). The builds include their licence texts.
