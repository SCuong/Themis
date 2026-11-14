// QA helper: open a design-lab page in Playwright Chromium at desktop and phone widths, print console errors, save screenshots.
// Usage: NODE_PATH=<repo>/node_modules node design-lab/tools/shoot.cjs <page relative to design-lab> [waitMs] [script.js run in page before shooting]
// Screenshots go to test-results/design-lab/ (gitignored).
const path = require('node:path');
const fs = require('node:fs');

const pw = require('playwright-core'); // run with NODE_PATH pointing at a node_modules that has it

(async () => {
  const [page = 'index.html', wait = '4000', scriptFile] = process.argv.slice(2);
  const url = 'file:///' + path.resolve(__dirname, '..', page).replace(/\\/g, '/');
  const out = path.resolve(__dirname, '../../test-results/design-lab');
  fs.mkdirSync(out, { recursive: true });
  const browser = await pw.chromium.launch();
  const name = page.replace(/[\\/]/g, '_').replace(/\.html$/, '');
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [375, 812, 'phone']]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const errors = [];
    p.on('console', m => m.type() === 'error' && errors.push(m.text()));
    p.on('pageerror', e => errors.push(String(e)));
    await p.goto(url);
    await p.waitForTimeout(Number(wait));
    if (scriptFile) await p.evaluate(fs.readFileSync(scriptFile, 'utf8'));
    await p.waitForTimeout(400);
    const file = path.join(out, `${name}-${tag}.png`);
    await p.screenshot({ path: file });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    console.log(`${tag}: ${file}${overflow > 0 ? `  HORIZONTAL OVERFLOW ${overflow}px` : ''}`);
    errors.forEach(e => console.log('  console error:', e));
    await p.close();
  }
  await browser.close();
})();
