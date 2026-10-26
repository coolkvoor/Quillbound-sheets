# Quillbound Sheets

A phone-first app for **[MPMB’s Character Record Sheet](https://www.flapkan.com/)**, the automated D&D 5e character sheet PDF by MorePurpleMoreBetter. Open your sheet's PDF and play or build your character on a phone or tablet. All the rules and automation come from the sheet's own scripts inside your PDF, run in a stand-in for Adobe Acrobat. Not made by MorePurpleMoreBetter (MPMB).

**Open the app: https://quillbound-sheets.pages.dev/**

## What you need

- **Your own copy of MPMB’s Character Record Sheet (PDF)**, from https://www.flapkan.com/. The 2024 sheets (v24) work, and so do the 2014 sheets (v14). The app contains none of the sheet's code and no book content.
- **Chrome** (or another Chromium browser, such as Edge) on Android or a computer. Other browsers are not tested yet.

## Using it

1. Open https://quillbound-sheets.pages.dev/ and pick your sheet's PDF.
2. Fill in and play your character. The sheet's menus and dialogs appear as the app's own panels.
3. Your character is **saved automatically on this device** in the browser. Nothing is uploaded: your sheet and character never leave the device.
4. **Sheet → Download PDF** writes your character into the PDF, which opens and works in Adobe Acrobat as well. Use it to keep a copy, or to move a character to another device.
5. For automatic copies, use **Settings (⚙) → Backups** and pick a folder. The app then writes your character's PDF there regularly.

## Install it as an app

Installing puts Quillbound on your home screen. It then opens in its own window without the browser bar, opens your last character straight away, and **works without a connection** once it has been opened.

- **Android (Chrome):** open the site, then tap the ⋮ menu → **Install app** (or **Add to home screen**). When Chrome offers it, the app also shows **Settings (⚙) → Install**.
- **Computer (Chrome or Edge):** click the install icon at the right of the address bar, or ⋮ menu → **Cast, save and share → Install page as app**.
- **iPhone and iPad:** not tested yet. In Safari, Share → **Add to Home Screen** may work.

**Updates** arrive by themselves. When a new version is out while the app is open, a bar offers **Reload**; your character is saved first.

## The one-file version

Each [release](https://github.com/coolkvoor/Quillbound-sheets/releases) has `Quillbound-Sheets.html`: the whole app in one file that you can keep on a device and open in Chrome without the website. It's a **backup**: it works fully offline, but it can't let the sheet pause for your answers, so it uses "restart and replay" for the sheet's dialogs (the same result, with a short extra moment per dialog). Its characters are kept separately from the web app's; move one with Download PDF.

## Developing

- `npm install`, then put a copy of MPMB’s Character Record Sheet at `test/sheet.pdf` (never commit it).
- `npm start` builds the app and serves it at http://localhost:8123.
- `npm test` runs the tests (they need `test/sheet.pdf`).
- `node tools/build-single.js` builds `dist-site/` (the website, as Cloudflare Pages builds it) and `dist-single/` (the one-file version).

The code: `src/loader.js` reads the PDF (pdf-lib); `src/engine.js` is the Acrobat stand-in the sheet's code runs against; `src/worker.js` runs one sheet per Web Worker (the sheet's code changes built-in prototypes, so it gets its own realm); `src/writer.js` and `src/appearance.js` save the character back into the PDF; `src/index.html`, `src/app.js` and `src/ui-*.js` are the screens; `src/pwa/` is the installable app (manifest, service worker, icons).

## Licence

Quillbound Sheets is free software under the GNU General Public License version 3 or (at your option) any later version; see [LICENSE](LICENSE). It comes with no warranty.

## Credits and licences

Quillbound Sheets is an independent app, not made, endorsed or supported by Wizards of the Coast or by MorePurpleMoreBetter (MPMB). Settings → Credits and licences in the app shows all of this, including the open sheet's own SRD attribution statement.

- Rules content comes from the user's sheet. The sheets include material from the System Reference Document (SRD 5.2.1 on 2024 sheets, SRD 5.1 on 2014 sheets) by Wizards of the Coast LLC, licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode).
- The rules automation is the sheet's own code from the user's PDF: MPMB’s Character Record Sheet by Joost Wijnen (MorePurpleMoreBetter, https://www.flapkan.com/), GPL-3.0. None of it is in this repository.
- Bundled in the builds: pdf-lib (copyright 2019 Andrew Dillon, MIT), PDF.js (Mozilla Foundation, Apache 2.0), Alegreya SC and Alegreya Sans (The Alegreya Project Authors, SIL Open Font License 1.1). The builds include their licence texts.
