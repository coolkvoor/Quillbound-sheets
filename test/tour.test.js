// The tour, clicked through as a user would: both tours, phone and tablet, light and dark.
// Usage: node test/tour.test.js [phone|tablet] [light|dark] [quick|full]   (default: all of them)
// Env: SHEET=path.pdf (default test/sheet.pdf; a saved character PDF is a good test too), DIST=folder (default dist-single).
// Checks per run: every step lights up something or shows its "missing" text, each chapter only scrolls down the page,
// the panels open and close on the real taps, the user's own character is the same before, during and after the tour,
// and no page errors. One run also reloads in the middle of a tour.
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright-core');
process.env.DIST = process.env.DIST || path.join(__dirname, '..', 'dist-single');
const { start } = require('./serve');
const PDF = process.env.SHEET || path.join(__dirname, 'sheet.pdf');
const PDFLIB = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.min.js'));
const DEVICES = {
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3.1, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 1.8, isMobile: true, hasTouch: true },
};
const pick = (all) => { const a = process.argv.slice(2).filter((x) => all.indexOf(x) !== -1); return a.length ? a : all; };
const CHAPTERS = { full: ['Set up', 'Build', 'Play', 'Keep it safe', 'Make it yours'], quick: ['Quick tour'] };

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', label.padEnd(60), detail === undefined ? '' : String(detail).slice(0, 200)); };

// what the app keeps for this character (IndexedDB), without the sheet's own "opened at" date
const stored = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('mpmb-sheet-app');
  r.onsuccess = () => {
    const out = {};
    const q = r.result.transaction('files').objectStore('files').openCursor();
    q.onsuccess = () => {
      const c = q.result;
      if (!c) { res(out); return; }
      if (/^(char|view|content|backup|dice):/.test(c.key)) { const v = c.value && c.value.state ? Object.assign({}, c.value.state, { date: 0 }) : c.value; out[c.key] = JSON.stringify(v); }
      c.continue();
    };
  };
}));

async function walk(page, kind, tag) {
  const seen = [], chapters = [];
  let lastChapter = null, lastY = -1, inPanelBefore = false;
  for (let n = 0; n < 60; n++) {
    await page.waitForTimeout(900);   // the page scrolls smoothly to each step
    const st = await page.evaluate(() => {
      const t = document.querySelector('#tour');
      if (!t) return null;
      const ring = t.querySelector('.tour-ring');
      return { label: t.querySelector('.tour-n').textContent, text: t.querySelector('.tour-text').textContent, wait: t.classList.contains('waiting'), miss: t.classList.contains('missing'),
        ring: ring.style.display !== 'none' && ring.getBoundingClientRect().width > 0, panel: t.parentNode.tagName === 'DIALOG', y: Math.round(scrollY), vh: innerHeight };
    });
    if (!st) break;
    seen.push(st);
    const chapter = st.label.split(' · ')[0];
    if (chapter && chapter !== lastChapter) { chapters.push(chapter); lastChapter = chapter; lastY = -1; }
    if (!st.text.trim() || (!st.ring && !st.miss)) check(tag + ' step "' + st.label + '" lights up something', false, st.text);
    // within a chapter, steps on the page only go down (panels scroll on their own); a little back is no jump (on a tablet
    // two cards side by side are lit one after the other)
    if (!st.panel && !inPanelBefore && lastY >= 0 && st.y < lastY - st.vh * 0.15) check(tag + ' "' + st.label + '" scrolls down, not back up', false, lastY + ' → ' + st.y + ': ' + st.text);
    if (!st.panel) lastY = st.y;
    inPanelBefore = st.panel;
    if (st.wait) {
      // the user's own tap, in the middle of the lit-up button
      const c = await page.$eval('#tour .tour-ring', (r) => { const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      await page.touchscreen.tap(c[0], c[1]);
    } else await page.tap('#tour .tour-foot .primary');
  }
  check(tag + ' ' + kind + ' tour: chapters in order', JSON.stringify(chapters) === JSON.stringify(CHAPTERS[kind]), chapters.join(' → '));
  check(tag + ' ' + kind + ' tour: every step showed something', seen.every((s) => s.text.trim() && (s.ring || s.miss)), seen.length + ' steps');
  check(tag + ' ' + kind + ' tour: the panels opened and closed on the taps', seen.some((s) => s.panel) && seen.filter((s) => s.wait).length >= 2, seen.filter((s) => s.wait).length + ' taps');
  return seen;
}

(async () => {
  if (!fs.existsSync(PDF)) { console.log('SKIP no sheet (put one at test/sheet.pdf or pass SHEET=)'); return; }
  const srv = await start(0);
  const url = 'http://localhost:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch());
  let reloaded = false;
  for (const dev of pick(Object.keys(DEVICES))) for (const scheme of pick(['light', 'dark'])) for (const kind of pick(['quick', 'full'])) {
    const tag = '[' + dev + ' ' + scheme + ']';
    const ctx = await browser.newContext(Object.assign({ colorScheme: scheme }, DEVICES[dev]));
    await ctx.route('https://cdnjs.cloudflare.com/**', (r) => (/pdf-lib/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: PDFLIB }) : r.abort()));
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
    await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.setInputFiles('#file', PDF);
    await page.waitForSelector('#sheet:not([hidden])', { timeout: 180000 });
    // the first time: the app offers the tour; say no for now
    const offered = await page.waitForFunction(() => document.querySelector('#tour-ask').open, null, { timeout: 30000 }).then(() => true, () => false);
    check(tag + ' the tour is offered after the first sheet opens', offered);
    if (offered) await page.tap('#tour-ask [data-tour="no"]');
    // the user's own change just before the tour
    const own = await page.$eval('#hdr-name', (n) => n.textContent);
    await page.fill('#f-player', 'Edited before the tour');
    await page.press('#f-player', 'Tab');
    await page.waitForFunction(() => document.querySelector('#save-chip').dataset.state === 'saved', null, { timeout: 20000 });
    await page.waitForTimeout(1200);
    const before = await stored(page);
    check(tag + ' the character is in storage', Object.keys(before).some((k) => /^char:/.test(k)), Object.keys(before).join(', '));
    // start it from Settings
    await page.tap('#settings-open');
    await page.tap('#tour-card [data-tour="' + (kind === 'full' ? 'long' : 'short') + '"]');
    await page.waitForSelector('#tour', { timeout: 90000 });
    const sample = await page.$eval('#hdr-name', (n) => n.textContent);
    check(tag + ' ' + kind + ' tour shows the sample character', /sample/i.test(sample), sample);
    const mid = await stored(page);
    check(tag + ' nothing stored while the sample is on screen', JSON.stringify(mid) === JSON.stringify(before));
    await walk(page, kind, tag);
    await page.waitForFunction(() => !document.querySelector('#tour') && document.querySelector('#tour-busy').hidden, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const back = { name: await page.$eval('#hdr-name', (n) => n.textContent), player: await page.$eval('#f-player', (n) => n.value) };
    check(tag + ' ' + kind + ' tour ends with the user\'s own character', back.name === own && back.player === 'Edited before the tour', back.name + ' / ' + back.player);
    await page.waitForTimeout(1500);
    check(tag + ' ' + kind + ' tour: storage the same as before', JSON.stringify(await stored(page)) === JSON.stringify(before));
    // once: a reload in the middle of a tour opens the user's own character, unchanged
    if (!reloaded) {
      reloaded = true;
      await page.evaluate(() => document.querySelector('#settings').open && document.querySelector('#settings').close());
      await page.tap('#settings-open');
      await page.tap('#tour-card [data-tour="short"]');
      await page.waitForSelector('#tour', { timeout: 90000 });
      await page.tap('#tour .tour-foot .primary');
      await page.reload();
      await page.click('#reopen').catch(() => {});
      await page.waitForSelector('#sheet:not([hidden])', { timeout: 180000 });
      await page.waitForTimeout(2500);
      check(tag + ' reload mid-tour: the user\'s own character', (await page.$eval('#hdr-name', (n) => n.textContent)) === own && (await page.$eval('#f-player', (n) => n.value)) === 'Edited before the tour');
      check(tag + ' reload mid-tour: storage the same as before', JSON.stringify(await stored(page)) === JSON.stringify(before));
    }
    check(tag + ' ' + kind + ' tour: no page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
