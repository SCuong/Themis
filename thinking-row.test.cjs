const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openFixture } = require('./ui-fixture.cjs');

// A slow member (e.g. Gemini with long thinking) must keep a visible status line, not vanish after 2 minutes.
test('a member thinking for a long time still shows a status line', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openFixture({
    language: 'vi',
    prepare: seed => {
      const [fresh, slow] = Object.values(seed.rolesById);
      Object.assign(fresh, { status: 'thinking', updatedAt: Date.now() });
      Object.assign(slow, { status: 'thinking', updatedAt: Date.now() - 5 * 60_000 });
    },
  });
  try {
    const rows = page.locator('.message-row.thinking .message-body');
    await rows.first().waitFor();
    const texts = await rows.allTextContents();
    assert.equal(texts.length, 2);
    assert.ok(texts.some(t => t.includes('Đang trả lời')), texts.join(' | '));
    assert.ok(texts.some(t => t.includes('Vẫn đang suy nghĩ')), texts.join(' | '));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
