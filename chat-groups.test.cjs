const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openFixture } = require('./ui-fixture.cjs');

const DAY = 864e5;
const listing = page => page.evaluate(() => [...document.querySelectorAll('#chat-list > *')]
  .map(node => (node.matches('.chat-group-label') ? `# ${node.textContent}` : node.querySelector('.chat-name')?.textContent)));

for (const [language, labels] of [
  ['vi', ['Hôm nay', 'Hôm qua', '7 ngày trước', '30 ngày trước']],
  ['en', ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days']],
]) {
  test(`chat list groups chats by date, newest first, without per-chat times (${language})`, { timeout: 60000 }, async () => {
    const now = Date.now();
    const old = new Date(now - 70 * DAY);
    const month = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}`;
    const { browser, page, errors } = await openFixture({ language, prepare: seed => {
      const base = Object.values(seed.chatsById)[0];
      base.updatedAt = now;
      // Added in creation order, oldest first, so the list must re-sort by activity.
      for (const [id, name, ago] of [['o', 'Dear ImGui', 70], ['m', 'Huffman', 20], ['w', 'Design Review', 3], ['y', 'Sprint planning', 1]]) {
        seed.chatsById[id] = { ...base, id, name, createdAt: now - ago * DAY, updatedAt: now - ago * DAY, roleIds: [], messageIds: [] };
        seed.chatOrder.push(id);
      }
    } });
    try {
      assert.deepEqual(await listing(page), [
        `# ${labels[0]}`, 'Product launch',
        `# ${labels[1]}`, 'Sprint planning',
        `# ${labels[2]}`, 'Design Review',
        `# ${labels[3]}`, 'Huffman',
        `# ${month}`, 'Dear ImGui',
      ]);
      assert.equal(await page.locator('#chat-list .chat-time').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
