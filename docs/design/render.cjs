// Renders the OfficeProof Lab artwork (art.js) to image files in docs/design/out. Needs Playwright with Chromium: node docs/design/render.cjs
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const font = fs.readFileSync(path.join(__dirname, '../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2')).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.setContent(`<style>@font-face{font-family:"JetBrains Mono";font-weight:500;src:url(data:font/woff2;base64,${font})}</style><body></body>`);
  await page.addScriptTag({ path: path.join(__dirname, 'art.js') });
  const out = await page.evaluate(() => window.renderAll());
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  for (const [name, url] of Object.entries(out)) { const buf = Buffer.from(url.split(',')[1], 'base64'); fs.writeFileSync(path.join(__dirname, 'out', name), buf); console.log(name, buf.length); }
  await browser.close();
})();
