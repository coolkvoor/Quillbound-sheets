// Opens the app in Chromium at the phone and tablet sizes, loads the sheet, builds a character, runs the self-test.
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright-core');
const { start } = require('./serve');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const PDF = path.join(__dirname, 'sheet.pdf');
const PDFLIB = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.min.js'));
// add-on content to add through the screen: CONTENT=file.js, or the first .js file in resources/ (skipped when none)
const RES = path.join(__dirname, '..', 'resources');
const CONTENT = process.env.CONTENT || (fs.existsSync(RES) ? fs.readdirSync(RES).filter((f) => /\.js$/i.test(f)).sort().map((f) => path.join(RES, f))[0] : null);

const DEVICES = {
  'phone-portrait': { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3.1, isMobile: true, hasTouch: true },
  'phone-landscape': { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3.1, isMobile: true, hasTouch: true },
  'tablet-portrait': { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 1.8, isMobile: true, hasTouch: true },
  'tablet-landscape': { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.8, isMobile: true, hasTouch: true },
};

(async () => {
  const srv = await start(0);
  const url = process.env.URL || ('http://localhost:' + srv.address().port + '/');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(async () => chromium.launch());
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(DEVICES);
  const scheme = process.env.SCHEME || 'light';
  for (const name of which) {
    const ctx = await browser.newContext(Object.assign({ colorScheme: scheme }, DEVICES[name]));
    await ctx.route('https://cdnjs.cloudflare.com/**', (r) => (process.env.NOCDN ? r.abort() : r.fulfill({ status: 200, contentType: 'text/javascript', body: PDFLIB })));
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
    await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
    await page.goto(url);
    await page.screenshot({ path: path.join(OUT, name + '-0-start.png') });
    const t0 = Date.now();
    await page.setInputFiles('#file', PDF);
    await page.waitForSelector('#sheet:not([hidden])', { timeout: 120000 });
    const openMs = Date.now() - t0;
    const facts = await page.$eval('#sheet-facts', (n) => n.innerText);
    console.log(`[${name}] opened in ${openMs} ms | ${facts.replace(/\n/g, ' | ')}`);
    const idle = () => page.waitForFunction(() => !document.querySelector('#busy').classList.contains('on'));
    // add-on content first, as MPMB recommends
    if (CONTENT) {
      await page.setInputFiles('#content-file', CONTENT);
      await page.waitForSelector('#content-result.ok, #content-result.err', { timeout: 120000 });
      const res = await page.$eval('#content-result', (n) => n.innerText.replace(/\n+/g, ' | '));
      const off = await page.$('[data-source]:not(:checked)');
      if (off) { await off.check(); await idle(); }
      const got = await page.evaluate(() => ({ species: Array.from(document.querySelectorAll('#dl-race option')).map((o) => o.value), hint: document.querySelector('#content-hint').innerText, chip: document.querySelector('#sources-chip').textContent }));
      console.log(`[${name}] content: ${res} | ${got.chip} | Aasimar listed: ${got.species.indexOf('Aasimar') !== -1} | ${got.hint}`);
      await page.$eval('#content', (n) => n.scrollIntoView());
      await page.screenshot({ path: path.join(OUT, name + '-0-content.png') });
    }
    // build a character through the screen
    const commit = async (sel, val) => { await page.fill(sel, val); await page.press(sel, 'Enter'); await idle(); };
    await commit('#f-name', 'Ilvara');
    for (const [k, v] of [['Str', '8'], ['Dex', '14'], ['Con', '14'], ['Int', '16'], ['Wis', '12'], ['Cha', '10']]) await commit('#f-abi-' + k, v);
    await commit('#f-race', 'Elf');
    const tc = Date.now();
    await commit('#f-class', 'Wizard 3');
    const classMs = Date.now() - tc;
    await commit('#f-class', 'Wizard 4');
    const lvl4 = await page.evaluate(() => ({ level: document.querySelector('[data-out="Character Level"]').textContent, header: document.querySelector('#hdr-line').textContent, cf: document.querySelector('[data-rich="Class Features"]').textContent.slice(0, 40), slots2: '' }));
    console.log(`[${name}] after level-up:`, JSON.stringify(lvl4));
    await commit('#f-armor', 'Unarmored');
    await commit('#f-atk1', 'Quarterstaff');
    await commit('#f-atk2', 'Fire Bolt');
    await commit('#f-hpmax', '17');
    await commit('#f-hp', '17');
    await page.click('#hp-minus'); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('on'));
    await page.click('[data-skill="Arc"]'); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('on'));
    const read = await page.evaluate(() => ({
      header: document.querySelector('#hdr-name').textContent + ' / ' + document.querySelector('#hdr-line').textContent,
      int: document.querySelector('[data-out="Int Mod"]').textContent, intSave: document.querySelector('[data-out="Int ST Mod"]').textContent,
      arc: document.querySelector('[data-out="Arc"]').textContent, ac: document.querySelector('[data-out="AC"]').textContent,
      hp: document.querySelector('#f-hp').value, atk2: document.querySelector('[data-out="Attack.2.To Hit"]').textContent,
      limited: Array.from(document.querySelectorAll('#limited li:not([hidden])')).map((l) => l.innerText.replace(/\s+/g, ' ')).join(' | '),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    console.log(`[${name}] class change ${classMs} ms (incl. UI) |`, JSON.stringify(read));
    await page.screenshot({ path: path.join(OUT, name + '-1-main.png') });
    await page.screenshot({ path: path.join(OUT, name + '-1-main-full.png'), fullPage: true });
    await page.click('[data-tab="combat"]'); await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, name + '-2-combat.png') });
    await page.click('[data-tab="features"]'); await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, name + '-3-features.png') });
    const tab = await page.$eval('[aria-current="true"]', (n) => n.dataset.tab);
    await page.click('[data-tab="sheetinfo"]'); await page.waitForTimeout(900);
    await page.click('#run-test');
    await page.waitForSelector('#test-out .pass, #test-out .fail', { timeout: 120000 });
    const test = await page.$eval('#test-out', (n) => n.innerText.split('\n').slice(0, 3).join(' | '));
    console.log(`[${name}] tab after jump: ${tab} | self-test: ${test}`);
    await page.screenshot({ path: path.join(OUT, name + '-4-sheet.png') });
    if (CONTENT) {
      // the content stays with the sheet: reload the app and reopen
      await page.reload();
      await page.click('#reopen');
      await page.waitForSelector('#sheet:not([hidden])', { timeout: 120000 });
      const back = await page.evaluate(() => ({ hint: document.querySelector('#content-hint').innerText, files: document.querySelector('#content-chip').textContent, aasimar: Array.from(document.querySelectorAll('#dl-race option')).some((o) => o.value === 'Aasimar') }));
      console.log(`[${name}] after reopen: ${back.files} | Aasimar listed: ${back.aasimar} | ${back.hint}`);
    }
    if (logs.length) console.log(`[${name}] console:`, logs.slice(0, 8).join(' || '));
    await ctx.close();
  }
  await browser.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
