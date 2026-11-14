const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openFixture } = require('./ui-fixture.cjs');

test('TeX in a reply is shown verbatim, not eaten by Markdown escapes or emphasis', { timeout: 60000 }, async () => {
  const content = [
    '**a)**',
    '',
    String.raw`$$\frac{2}{3}\sqrt{9}-\frac{3}{2}\sqrt{(-6)^2}+7$$`,
    '',
    String.raw`Ta có: $a_1 = \{x\}$ và $b_1 + c_1$, giá $5 và $10.`,
    '',
    String.raw`$$\begin{aligned} x &= 1 \\ y &= 2 \end{aligned}$$`,
  ].join('\n');
  const { browser, page, errors } = await openFixture({ prepare(seed) { seed.messagesById.answer2.content = content; } });
  try {
    const body = page.locator('.message-row').last().locator('.message-body');
    assert.deepEqual(await body.locator('p').allInnerTexts(), [
      'a)',
      String.raw`$$\frac{2}{3}\sqrt{9}-\frac{3}{2}\sqrt{(-6)^2}+7$$`,
      String.raw`Ta có: $a_1 = \{x\}$ và $b_1 + c_1$, giá $5 và $10.`,
      String.raw`$$\begin{aligned} x &= 1 \\ y &= 2 \end{aligned}$$`,
    ]);
    assert.equal(await body.locator('strong').count(), 1);
    assert.equal(await body.locator('em').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
