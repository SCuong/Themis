// Interaction check for OPEN CASE: retry, follow-up dispute, select→critique→send, argument view. Run with NODE_PATH set (see shoot.cjs).
const path = require('node:path');
const assert = require('node:assert');
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await p.goto(require('node:url').pathToFileURL(path.resolve(__dirname, '../open-case/index.html')).href + '?speed=8');
  await p.waitForSelector('.draft.is-error');
  await p.click('[data-retry="van"]');
  await p.waitForSelector('#dispute-d3', { timeout: 15000 });
  assert.strictEqual(await p.locator('.draft').count(), 0, 'all drafts filed');
  assert.strictEqual(await p.locator('.entry').count(), 12, '6 history + 5 live + 1 follow-up');
  // select a sentence in Khoa's first entry and ask Rook to critique it
  await p.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    const para = document.querySelector('#e-h-khoa-1 .prose p:nth-of-type(3)');
    para.scrollIntoView({ block: 'center' });
    const r = document.createRange(); r.selectNodeContents(para);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    para.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await p.waitForSelector('#seltool:not([hidden])');
  await p.click('[data-act="critique"]');
  await p.click('[data-ask="rook"]');
  assert.match(await p.inputValue('#composer-text'), /^@Rook/);
  assert(await p.isVisible('#composer-quote'));
  assert.strictEqual(await p.textContent('#send'), 'Gửi cho Rook');
  await p.keyboard.press('Control+Enter');
  assert(!(await p.isVisible('#composer-quote')), 'quote clears after send');
  await p.waitForFunction(() => [...document.querySelectorAll('.entry')].length === 13, null, { timeout: 15000 });
  await p.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await p.screenshot({ path: path.resolve(__dirname, '../../test-results/design-lab/open-case-after-send.png') });
  await p.click('#tab-args');
  await p.screenshot({ path: path.resolve(__dirname, '../../test-results/design-lab/open-case-args.png') });
  assert.strictEqual(await p.locator('.matrix tbody tr').count(), 3);
  assert.deepStrictEqual(errors, []);
  console.log('open-case interaction check: ok');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
