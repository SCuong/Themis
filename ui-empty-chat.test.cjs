const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openFixture } = require('./ui-fixture.cjs');

test('a chat without members locks the composer and shows one Add action; a chat with members unlocks it', { timeout: 60000 }, async () => {
  const now = new Date('2026-11-14T03:00:00Z').getTime();
  const { browser, page, errors } = await openFixture({
    language: 'vi', title: 'Cuộc trò chuyện mới',
    prepare(seed) {
      seed.chatsById.empty = { id: 'empty', name: 'Cuộc trò chuyện mới', mode: 'independent', status: 'draft', roleIds: [], messageIds: [], nextMessageSeq: 1, createdAt: now, updatedAt: now, requireManualMention: true };
      seed.chatOrder = ['empty', 'chat'];
      seed.currentChatId = 'empty';
    },
  });
  try {
    // Header: title, then the chat's own mode, then its status; no subtitle line or tile.
    assert.equal(await page.locator('#chat-subtitle').textContent(), 'Chuyên gia độc lập');
    assert.equal(await page.locator('#chat-status').textContent(), 'Bản nháp');
    assert.equal(await page.locator('.chat-header-avatar, .chat-meta-item').count(), 0);

    // Empty state: illustration and a single action.
    const card = page.locator('.messages .empty-card-people');
    assert.equal(await card.locator('.empty-illustration svg').count(), 1);
    assert.deepEqual(await card.locator('button').allTextContents(), ['Thêm']);
    assert.equal(await card.locator('button').getAttribute('aria-label'), 'Thêm thành viên');

    // Composer: everything locked, with a placeholder that says why.
    const input = page.locator('#message-input');
    assert.equal(await input.isDisabled(), true);
    assert.equal(await input.getAttribute('placeholder'), 'Vui lòng thêm thành viên để bắt đầu trò chuyện');
    assert.equal(await page.locator('#attach-file').isDisabled(), true);
    assert.equal(await page.locator('#send-message').isDisabled(), true);

    // Sidebar rows are text only.
    assert.equal(await page.locator('.chat-list .chat-avatar, .chat-list .summary-line').count(), 0);

    // The ⋯ icon sits at its button's centre (its hidden glyph is a 2nd grid row that must not lift it), inset from the row edge.
    const menu = await page.locator('.chat-item.active .chat-menu-btn').evaluate(button => {
      const rows = getComputedStyle(button).gridTemplateRows.split(' ').map(parseFloat);
      const inner = button.clientHeight;
      const iconCentre = (inner - rows.reduce((sum, row) => sum + row, 0)) / 2 + rows[0] / 2;
      const gap = button.closest('.chat-item').getBoundingClientRect().right - button.getBoundingClientRect().right;
      return { offCentre: Math.abs(iconCentre - inner / 2) < 1, inset: gap >= 2, label: button.getAttribute('aria-label') };
    });
    assert.deepEqual(menu, { offCentre: true, inset: true, label: 'Mở menu của Cuộc trò chuyện mới' });

    // A chat with members unlocks it, and the placeholder follows (not the first value the translator cached).
    await page.locator('.chat-item[data-chat-id="chat"] .chat-name').click();
    await page.locator('#chat-title').filter({ hasText: 'Product launch' }).waitFor();
    assert.equal(await input.isDisabled(), false);
    assert.equal(await input.getAttribute('placeholder'), 'Nhắn cho nhóm');
    assert.equal(await page.locator('#chat-subtitle').textContent(), 'Thảo luận nhóm');
    assert.equal(await page.locator('.manual-mention-toggle').isDisabled(), false);

    // The status pill is whole or a dot at every width, never cut mid-word ("Đan…").
    await page.evaluate(() => { document.getElementById('chat-title').textContent = 'Cuộc trò chuyện mới'; });
    for (const width of [320, 375, 480, 520, 625, 720, 760, 900, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const status = await page.locator('#chat-status').evaluate(el => ({ fits: el.scrollWidth <= el.clientWidth, title: el.title }));
      assert.deepEqual(status, { fits: true, title: 'Đang hoạt động' }, `status at ${width}px`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no page overflow at ${width}px`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
