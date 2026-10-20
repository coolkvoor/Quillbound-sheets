# Quillbound Sheets

Works with MPMB character sheets (not made by MPMB). Phone-first web app that opens an MPMB 2024 character sheet PDF and runs the sheet's own scripts in a stand-in for Acrobat.

- `src/loader.js` reads the PDF (pdf-lib): scripts, fields, calculation order, templates, bookmarks.
- `src/engine.js` the Acrobat stand-in (fields, events, app/util/doc APIs) that MPMB's code runs against.
- `src/worker.js` runs one sheet per Web Worker (MPMB changes built-in prototypes, so it gets its own realm).
- `src/app.js`, `src/index.html` the screens.
- `src/selftest.js` the Elf Wizard 3 check, used by the app and `test/engine.test.js`.

Build: `tools/build.sh` → `dist/`. Tests: put an MPMB sheet at `test/sheet.pdf`, run `node test/loader.test.js` (writes `test/model.json`), `node test/engine.test.js`, `node test/ui.test.js`.

No MPMB code or book content is included; users bring their own sheet.
