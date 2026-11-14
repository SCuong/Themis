const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openFixture } = require('./ui-fixture.cjs');

test('Themis switches between Vietnamese and English across its main screens', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openFixture({ language: 'zh-CN', viewport: { width: 1440, height: 960 } });
  async function assertNoChinese(screen) {
    const labels = await page.evaluate(() => {
      const visible = element => {
        if (!element.checkVisibility({ checkVisibilityCSS: true })) return false;
        const bounds = element.getBoundingClientRect();
        return bounds.width && bounds.height && bounds.right > 0 && bounds.left < innerWidth;
      };
      return [...document.querySelectorAll('body *')].filter(visible).flatMap(element => [
        ...[...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()),
        ...['aria-label', 'title', 'placeholder', 'data-tooltip'].map(attribute => element.getAttribute(attribute)),
      ]).filter(text => text && /\p{Script=Han}/u.test(text));
    });
    assert.deepEqual([...new Set(labels)], [], screen);
  }
  try {
    await page.locator('html[lang=vi]').waitFor({ state: 'attached' });
    await assertNoChinese('Vietnamese chat');
    assert.match(await page.locator('#send-message').getAttribute('aria-label') ?? '', /Gửi/);
    await page.locator('#settings-button').click();
    assert.equal(await page.locator('.settings-segment-option').count(), 2);
    await page.locator('#language-en').click();
    await page.locator('html[lang=en]').waitFor({ state: 'attached' });
    await assertNoChinese('English settings');
    await page.locator('#language-vi').click();
    await page.locator('html[lang=vi]').waitFor({ state: 'attached' });
    await page.locator('#settings-button').click();
    await page.locator('#toggle-people-drawer').click();
    await assertNoChinese('Members');
    await page.locator('#close-people-drawer').click();
    await page.locator('#open-people-library').click();
    await page.locator('#people-library-tab-builtin').click();
    await assertNoChinese('Built-in people');
    await page.locator('#close-people-library').click();
    await page.locator('#quick-create-chat').click();
    await page.locator('#open-group-template-create').click();
    await assertNoChinese('Chat templates');
    await page.locator('#close-group-template-modal').click();
    await page.locator('#open-orchestration').click();
    await assertNoChinese('Orchestration');
    await page.locator('.orchestration-stage-canvas .x6-graph-svg').waitFor({ state: 'attached' });
    await page.locator('.orchestration-person').first().click();
    await page.locator('.orchestration-stage-canvas [data-stage-id][role="button"]').first().press('Enter');
    assert.match(await page.locator('#orchestration-stage-settings').innerText(), /Loại bước/);
    assert.match(await page.locator('#orchestration-stage-settings').innerText(), /Tên bước/);
    assert.match(await page.locator('#orchestration-task').getAttribute('placeholder'), /Mô tả nhiệm vụ/);
    await page.locator('[data-stage-kind]').selectOption('review');
    assert.match(await page.locator('#orchestration-review-settings').innerText(), /Tiêu chí đánh giá/);
    await page.locator('#close-orchestration').click();
    await page.setViewportSize({ width: 375, height: 812 });
    await assertNoChinese('Vietnamese on a 375 px screen');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
