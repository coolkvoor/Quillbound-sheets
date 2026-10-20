// Draws src/pwa/icon.svg as the PNG icons the installed app needs (Chrome wants 192 and 512 px PNGs).
// node tools/make-icons.js   (run again after changing icon.svg; the PNGs are committed)
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const dir = path.join(__dirname, '..', 'src', 'pwa');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch());
  const page = await browser.newPage();
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  for (const size of [192, 512, 180]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent('<html><body style="margin:0">' + svg.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ') + '</body></html>');
    const name = size === 180 ? 'apple-touch-icon.png' : 'icon-' + size + '.png';
    await page.screenshot({ path: path.join(dir, name), omitBackground: false });
    console.log('src/pwa/' + name);
  }
  await browser.close();
})();
