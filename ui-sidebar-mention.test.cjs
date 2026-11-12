const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { test } = require('node:test');
const { openFixture } = require('./ui-fixture.cjs');

test('mentionSegments marks only labels of this chat, like the send parser', async () => {
  const { mentionSegments } = await import(pathToFileURL(path.join(__dirname, 'team-ui.js')).href);
  const labels = ['Everyone', 'Engineer', 'Engineer(ChatGPT)', 'Nguyễn Văn An'];
  assert.deepEqual(mentionSegments('Hi @Engineer(ChatGPT), @Nobody @Engineers @Nguyễn Văn An @Everyone', labels), [
    { text: 'Hi ', mention: false },
    { text: '@Engineer(ChatGPT)', mention: true },
    { text: ', @Nobody @Engineers ', mention: false },
    { text: '@Nguyễn Văn An', mention: true },
    { text: ' ', mention: false },
    { text: '@Everyone', mention: true },
  ]);
  assert.deepEqual(mentionSegments('@Engineer', []), [{ text: '@Engineer', mention: false }]);
  assert.deepEqual(mentionSegments('', labels), []);
});

test('@mention menu: Tab/Enter pick the highlighted item, arrows move, Escape closes', { timeout: 30000 }, async () => {
  const { browser, page, errors } = await openFixture();
  try {
    page.setDefaultTimeout(5000);
    const input = page.locator('#message-input');
    const panel = page.locator('#mention-panel');
    const active = () => page.locator('.mention-option.active .mention-name').innerText();
    const inputFocused = () => input.evaluate(el => el === document.activeElement);

    await input.click();
    await page.keyboard.type('Hi @');
    await panel.waitFor();
    assert.equal(await active(), 'Everyone');
    await page.keyboard.press('Tab');
    assert.equal(await input.inputValue(), 'Hi @Everyone ');
    assert.ok(await inputFocused(), 'Tab keeps the caret in the composer');
    assert.equal(await panel.isHidden(), true);

    await page.keyboard.type('@');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await active(), 'Engineer');
    await page.keyboard.press('Tab');
    assert.match(await input.inputValue(), /^Hi @Everyone @Engineer\S* $/);
    assert.ok(await inputFocused());

    await page.keyboard.type('@');
    await page.keyboard.press('ArrowUp');
    assert.equal(await active(), 'GrowthAdvisor', 'ArrowUp wraps to the last item');
    await page.keyboard.press('Enter');
    assert.match(await input.inputValue(), /@GrowthAdvisor\S* $/);
    assert.equal(await page.evaluate(() => window.__fixtureCommands.some(c => c.type === 'GROUP_MESSAGE_SEND')), false, 'Enter picked, not sent');

    // The composer colours mentions through its mirror layer.
    const mentions = await page.locator('#message-input-mirror .message-input-mention').allInnerTexts();
    assert.equal(mentions.length, 3);
    assert.equal(mentions[0], '@Everyone');
    const mention = page.locator('#message-input-mirror .message-input-mention').first();
    assert.notEqual(await mention.evaluate(el => getComputedStyle(el).color),
      await page.locator('#message-input-mirror').evaluate(el => getComputedStyle(el).color), 'mention text has its own colour');
    assert.deepEqual(await mention.evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow]), ['rgba(0, 0, 0, 0)', 'none'], 'no chip or outline');
    await page.keyboard.type(' @Nobody ');
    assert.equal(await page.locator('#message-input-mirror .message-input-mention').count(), 3, 'a name outside the chat stays plain');

    await page.keyboard.type('@');
    await panel.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await panel.isHidden(), true);
    await page.waitForTimeout(50);
    assert.equal(await panel.isHidden(), true, 'Escape keeps the menu closed after keyup');
    await page.keyboard.press('Tab');
    assert.equal(await inputFocused(), false, 'with the menu closed Tab moves focus normally');
    assert.ok(/@$/.test(await input.inputValue()), 'Tab with the menu closed inserts nothing');

    await input.fill('@Engineer check the signup flow');
    await input.press('Enter');
    await page.waitForFunction(() => window.__fixtureCommands.some(c => c.type === 'GROUP_MESSAGE_SEND'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('one sidebar holds navigation, chats and settings; collapses on wide windows and becomes a drawer on narrow ones', { timeout: 30000 }, async () => {
  const { browser, page, errors } = await openFixture({ viewport: { width: 1440, height: 900 } });
  try {
    page.setDefaultTimeout(5000);
    const sidebar = page.locator('#chat-sidebar');
    for (const id of ['quick-create-chat', 'open-all-notes', 'open-people-library', 'open-external-models', 'settings-button', 'chat-list']) {
      assert.equal(await sidebar.locator(`#${id}`).count(), 1, `${id} lives in the sidebar`);
    }
    assert.equal(await page.locator('.app-shell > .rail').count(), 0, 'no separate rail column');
    const arrowCursor = await page.evaluate(() => [...document.querySelectorAll('button, [role="button"], [role="switch"], [role="tab"]')]
      .filter(el => el.checkVisibility() && !el.disabled && !el.matches('.window-resize-handle, .notes-resize-handle') && getComputedStyle(el).cursor !== 'pointer')
      .map(el => el.id || el.className));
    assert.deepEqual(arrowCursor, [], 'every clickable control shows the hand cursor');
    const columns = () => page.locator('.app-shell').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(await columns(), 2);
    assert.equal(await page.locator('#open-chats').isVisible(), false, 'list heading replaces the Chats button when expanded');

    const transition = () => page.locator('.app-shell').evaluate(el => getComputedStyle(el).transitionProperty);
    assert.equal(await transition(), 'none', 'reduced motion folds instantly');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.match(await transition(), /grid-template-columns/, 'folding animates the column width');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#collapse-sidebar').click();
    assert.equal(await page.locator('#collapse-sidebar').getAttribute('aria-expanded'), 'false');
    assert.ok((await sidebar.boundingBox()).width <= 72);
    assert.equal(await page.locator('#chat-list').isVisible(), false);
    await page.locator('#open-all-notes').hover();
    await page.locator('.ui-tooltip.visible').waitFor();
    assert.equal(await page.locator('.ui-tooltip').innerText(), 'Notes', 'collapsed rail icons name themselves on hover');
    await page.mouse.move(700, 400);
    await page.locator('.ui-tooltip.visible').waitFor({ state: 'detached' }).catch(() => {});
    assert.equal(await page.locator('.ui-tooltip.visible').count(), 0);
    await page.reload();
    await page.locator('#chat-title').filter({ hasText: 'Product launch' }).waitFor();
    assert.ok((await sidebar.boundingBox()).width <= 72, 'collapsed state survives reload');
    await page.locator('#open-chats').click();
    assert.equal(await page.locator('#chat-list').isVisible(), true, 'Chats expands the collapsed rail');
    await page.locator('#collapse-sidebar').click();
    await page.locator('#quick-create-chat').click();
    await page.locator('#new-chat-name').waitFor();
    assert.ok((await sidebar.boundingBox()).width > 200, 'New chat expands the rail to show its form');
    await page.locator('#cancel-create-chat').click();

    const restore = page.locator('#restore-chat');
    const fill = () => restore.evaluate(el => getComputedStyle(el).backgroundColor);
    const restFill = await fill();
    await restore.hover();
    await page.locator('.ui-tooltip.visible').waitFor();
    assert.equal(await page.locator('.ui-tooltip').innerText(), 'Restore session');
    assert.notEqual(await fill(), restFill, 'restore button reacts to hover');
    await page.mouse.move(700, 400);

    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.locator('#collapse-sidebar').isVisible(), false);
    assert.equal(await sidebar.evaluate(el => el.inert), true);
    await page.locator('#toggle-chat-sidebar').click();
    await page.locator('#settings-button').waitFor();
    const box = await sidebar.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 375);
    await page.locator('#settings-button').click();
    const menu = await page.locator('#settings-menu').boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= 375 && menu.y >= 0, 'settings menu fits the narrow drawer');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#toggle-chat-sidebar').getAttribute('aria-expanded'), 'true', 'Escape closes the menu before the drawer');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
