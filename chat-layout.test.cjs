const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openFixture } = require('./ui-fixture.cjs');

test('messages and composer share one centred column; answers use its full width', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openFixture({ language: 'vi', prepare: seed => {
    const chat = Object.values(seed.chatsById)[0];
    const last = seed.messagesById[chat.messageIds.at(-1)];
    const long = 'Một câu trả lời dài để kiểm tra rằng nội dung dùng hết bề rộng cột hội thoại thay vì bị bó hẹp. '.repeat(4);
    for (const id of ['wide-1', 'wide-2']) {
      seed.messagesById[id] = { ...last, id, content: long, seq: chat.nextMessageSeq++, createdAt: last.createdAt + 1000 };
      chat.messageIds.push(id);
    }
  } });
  try {
    for (const width of [1920, 1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const m = await page.evaluate(() => {
        const box = el => el.getBoundingClientRect();
        const rows = [...document.querySelectorAll('.message-row.assistant')];
        const row = box(rows.at(-2)), body = box(rows.at(-2).querySelector('.message-body')), composer = box(document.getElementById('composer'));
        const list = document.querySelector('.messages');
        return {
          rowX: row.x, rowW: row.width, composerX: composer.x, composerW: composer.width,
          bodyRight: body.right, rowRight: row.right,
          avatar: box(rows.at(-2).querySelector('.message-avatar')).width,
          grouped: !rows.at(-1).querySelector('.message-name') && rows.at(-1).classList.contains('no-avatar'),
          hScroll: document.documentElement.scrollWidth > innerWidth || list.scrollWidth > list.clientWidth,
        };
      });
      assert.equal(Math.round(m.rowX), Math.round(m.composerX), `${width}: message column and composer start together`);
      assert.equal(Math.round(m.rowW), Math.round(m.composerW), `${width}: message column and composer are equally wide`);
      assert.ok(m.rowRight - m.bodyRight < 2, `${width}: a long answer reaches the right edge of the column`);
      assert.ok(m.avatar <= 36, `${width}: avatar stays small (${m.avatar}px)`);
      assert.ok(m.grouped, `${width}: a follow-up from the same agent does not repeat avatar and name`);
      assert.equal(m.hScroll, false, `${width}: no horizontal scroll`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
