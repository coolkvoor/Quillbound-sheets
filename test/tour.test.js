// The guides, clicked through as a user would: the quick tour, the full tour and the character guide, phone and tablet,
// light and dark. Usage: node test/tour.test.js [phone|tablet] [light|dark] [quick|full|build]   (default: all of them)
// Env: SHEET=path.pdf (default test/sheet.pdf; a saved character PDF is a good test too), DIST=folder (default dist-single),
// SHOTS=folder (a screenshot of every step).
// Checks per run: the offer fits the sheet (the guide for an empty sheet, the full tour for a made character); every
// step lights up something or shows its "missing" text, each chapter only scrolls down the page, the panels open and
// close on the real taps, the tours run on the user's own character and leave it (and storage) as it was; the guide
// leaves the page usable, goes on by itself once a step is done (a species typed in) and keeps what was done; no page
// errors. One run also reloads in the middle of a tour.
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
const CHAPTERS = { full: ['Sources', 'Your character', 'Play', 'Gear and pages', 'Keep it safe', 'Make it yours'], quick: ['Quick tour'] };

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
    if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, (tag + ' ' + kind + ' ' + String(n + 1).padStart(2, '0')).replace(/[^\w]+/g, '-') + '.png') }); }
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

// the character guide: the page stays usable; a species typed in moves it on by itself; Skip and Next go through the rest
// the sheet's own dialogs and questions that a step brings up (Human's choices): answered with their main button, as a
// user would; the guide steps aside meanwhile
const answerDialogs = (page) => page.evaluate(() => {
  const d = Array.from(document.querySelectorAll('dialog[open]')).filter((x) => x.id !== 'tour-ask')[0];
  if (!d) return false;
  const b = d.querySelector('.panel-foot .btn.primary, .panel-foot .btn:last-child, .md-foot .btn.primary, .md-foot .btn:last-child');
  if (b) b.click(); else d.close();
  return true;
});
async function walkBuild(page, tag, empty) {
  const seen = [];
  let typed = false, movedOn = null;
  for (let n = 0; n < 60; n++) {
    await page.waitForTimeout(900);
    if (await answerDialogs(page)) { n--; continue; }
    const st = await page.evaluate(() => {
      const t = document.querySelector('#tour');
      if (!t) return null;
      const ring = t.querySelector('.tour-ring'), dim = t.querySelector('.tour-dim');
      const shownBtn = (b) => !b.hidden && getComputedStyle(b).display !== 'none';
      const btns = Array.from(t.querySelectorAll('.tour-foot .btn')).filter(shownBtn).map((b) => b.textContent);
      return { label: t.querySelector('.tour-n').textContent, text: t.querySelector('.tour-text').textContent, miss: t.classList.contains('missing'),
        ring: ring.style.display !== 'none' && ring.getBoundingClientRect().width > 0, dimmed: getComputedStyle(dim).display !== 'none', btns };
    });
    if (!st) break;
    seen.push(st);
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, (tag + ' build ' + String(n + 1).padStart(2, '0')).replace(/[^\w]+/g, '-') + '.png') });
    if (!st.text.trim() || (!st.ring && !st.miss)) check(tag + ' guide step "' + st.label + '" lights up something', false, st.text);
    if (st.dimmed) check(tag + ' guide step "' + st.label + '": the page is not dimmed', false, st.text);
    // the species step on an empty sheet: do it, and the guide goes on by itself
    if (empty && !typed && /species/i.test(st.text) && st.btns.indexOf('Skip') !== -1) {
      typed = true;
      await page.fill('#f-race', 'Human');
      await page.press('#f-race', 'Tab');
      movedOn = false;
      for (let w = 0; w < 60 && !movedOn; w++) {
        await page.waitForTimeout(1000);
        await answerDialogs(page);
        movedOn = await page.evaluate((was) => { const t = document.querySelector('#tour .tour-text'); return !!t && !/species/i.test(t.textContent) && t.textContent !== was; }, st.text);
      }
      continue;
    }
    const b = st.btns.indexOf('Skip') !== -1 ? 'Skip' : st.btns.filter((x) => x !== 'Stop' && x !== 'Back').pop();
    await page.$$eval('#tour .tour-foot .btn', (bs, want) => { const x = bs.filter((y) => y.textContent === want && !y.hidden)[0]; if (x) x.click(); }, b);
  }
  check(tag + ' guide: every step showed something', seen.length > 3 && seen.every((s) => s.text.trim() && (s.ring || s.miss)), seen.length + ' steps');
  if (empty) check(tag + ' guide: goes on by itself once the species is picked', typed && movedOn, typed ? 'typed' : 'no species step');
  return seen;
}

(async () => {
  if (!fs.existsSync(PDF)) { console.log('SKIP no sheet (put one at test/sheet.pdf or pass SHEET=)'); return; }
  const srv = await start(0);
  const url = 'http://localhost:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch());
  let reloaded = false;
  for (const dev of pick(Object.keys(DEVICES))) for (const scheme of pick(['light', 'dark'])) for (const kind of pick(['quick', 'full', 'build'])) {
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
    const empty = await page.evaluate(() => !document.querySelector('[data-rich="Class Features"] details.feat') && !document.querySelector('#f-race').value);
    if (offered) {
      const offer = await page.evaluate(() => ({ build: !document.querySelector('#tour-ask [data-tour="build"]').hidden, full: !document.querySelector('#tour-ask [data-tour="full"]').hidden }));
      check(tag + ' the offer fits the sheet (' + (empty ? 'empty: the guide' : 'a character: the full tour') + ')', offer.build === empty && offer.full === !empty, JSON.stringify(offer));
      await page.tap('#tour-ask [data-tour="no"]');
    }
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
    await page.tap('#tour-card [data-tour="' + kind + '"]');
    await page.waitForSelector('#tour', { timeout: 90000 });
    check(tag + ' ' + kind + ': on the user\'s own character', (await page.$eval('#hdr-name', (n) => n.textContent)) === own);
    if (kind === 'build') {
      await walkBuild(page, tag, empty);
      await page.waitForFunction(() => !document.querySelector('#tour'), null, { timeout: 30000 });
      await page.waitForTimeout(1500);
      if (empty) {
        const race = await page.$eval('#f-race', (n) => n.value);
        check(tag + ' guide: what was done is kept (species)', race === 'Human', race);
        await page.waitForFunction(() => document.querySelector('#save-chip').dataset.state === 'saved', null, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1200);
        check(tag + ' guide: the change is in storage', JSON.stringify(await stored(page)) !== JSON.stringify(before));
      }
    } else {
      await walk(page, kind, tag);
      await page.waitForFunction(() => !document.querySelector('#tour'), null, { timeout: 30000 });
      await page.waitForTimeout(1500);
      const back = { name: await page.$eval('#hdr-name', (n) => n.textContent), player: await page.$eval('#f-player', (n) => n.value) };
      check(tag + ' ' + kind + ' tour ends with the user\'s own character as it was', back.name === own && back.player === 'Edited before the tour', back.name + ' / ' + back.player);
      await page.waitForTimeout(1500);
      check(tag + ' ' + kind + ' tour: storage the same as before', JSON.stringify(await stored(page)) === JSON.stringify(before));
    }
    // once: a reload in the middle of a tour opens the user's own character, unchanged
    if (!reloaded && kind !== 'build') {
      reloaded = true;
      await page.evaluate(() => document.querySelector('#settings').open && document.querySelector('#settings').close());
      await page.tap('#settings-open');
      await page.tap('#tour-card [data-tour="quick"]');
      await page.waitForSelector('#tour', { timeout: 90000 });
      await page.waitForTimeout(900);
      await page.reload();
      await page.click('#reopen').catch(() => {});
      await page.waitForSelector('#sheet:not([hidden])', { timeout: 180000 });
      await page.waitForTimeout(2500);
      check(tag + ' reload mid-tour: the user\'s own character', (await page.$eval('#hdr-name', (n) => n.textContent)) === own && (await page.$eval('#f-player', (n) => n.value)) === 'Edited before the tour');
      check(tag + ' reload mid-tour: storage the same as before', JSON.stringify(await stored(page)) === JSON.stringify(before));
    }
    check(tag + ' ' + kind + ': no page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
