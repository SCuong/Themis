const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { openFixture } = require('./ui-fixture.cjs');

async function sidebarItem(page, selector) {
  const item = page.locator(selector);
  if (!(await item.isVisible())) await page.locator('#toggle-chat-sidebar').click();
  return item;
}
async function closeDrawer(page) {
  if (await page.locator('#close-chat-sidebar').isVisible()) await page.locator('#close-chat-sidebar').click();
}

const baseline = process.env.UI_BASELINE === '1';
const output = path.join(__dirname, 'test-results', baseline ? 'before' : 'after');

test('all workspaces and dialogs fit desktop and narrow Chrome viewports in both themes', { timeout: 120000 }, async () => {
  await mkdir(output, { recursive: true });
  const measurements = [];
  const viewports = [[1440, 'light'], [375, 'dark']];
  if (!baseline) viewports.push([960, 'dark']);
  for (const [width, theme] of viewports) {
    const { browser, page, errors } = await openFixture({
      viewport: { width, height: { 375: 812, 960: 680, 1440: 960 }[width] },
      root: baseline ? path.join(__dirname, 'test-results/baseline') : __dirname,
      prepare(seed) {
        seed.settings.externalModelOrder = ['fixture'];
        seed.settings.externalModelsById.fixture = {
          id: 'fixture', name: 'Example model', format: 'openai',
          baseUrl: 'https://example.invalid/v1', apiKey: 'fixture-only', modelName: 'example-model',
        };
      },
    });
    try {
      page.setDefaultTimeout(5000);
      const allTells = new Set();
      await (await sidebarItem(page, '#settings-button')).click();
      await page.locator(`#theme-${theme}`).click();
      await page.locator('#settings-button').click();
      await closeDrawer(page);
      async function capture(name) {
        await page.mouse.move(1, 1);
        await page.screenshot({ path: path.join(output, `${width}-${theme}-${name}.png`) });
        const result = await page.evaluate(() => {
          const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(el => el.checkVisibility());
          const root = dialogs.at(-1) || document.querySelector('.notes-panel.open, .role-panel.open, .settings-menu:not([hidden])') || document.querySelector('.app-shell');
          const box = root.getBoundingClientRect();
          return { x: box.x, right: box.right, top: box.y, bottom: box.bottom, viewport: [innerWidth, innerHeight], overflow: root.scrollWidth - root.clientWidth };
        });
        const tells = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.checkVisibility()).flatMap(el =>
          [null, '::before', '::after'].flatMap(pseudo => {
            const style = getComputedStyle(el, pseudo);
            if (pseudo && style.content === 'none') return [];
            return [
              /gradient/.test(style.backgroundImage) && 'gradient',
              style.backdropFilter !== 'none' && 'glass',
              style.textTransform === 'uppercase' && 'uppercase',
              // Elevation belongs to surfaces that float over the page, never to elements at rest.
              style.boxShadow !== 'none' && !el.matches('.modal, .settings-menu, .chat-action-menu, .mention-panel, .role-site-menu, .mark-menu, .notes-panel, .role-panel, .toast, .launcher, .orchestration-status-floating') && 'shadow',
            ].filter(Boolean).map(kind => `${kind}: ${el.tagName.toLowerCase()}.${el.className}${pseudo || ''}`);
          })));
        measurements.push({ width, theme, name, ...result, tells: [...new Set(tells)] });
        for (const tell of tells) allTells.add(`${name} ${tell}`);
        if (!baseline) {
          assert.ok(result.x >= -1 && result.right <= width + 1, `${name} fits ${width}px horizontally: ${JSON.stringify(result)}`);
          assert.ok(result.top >= -1 && result.bottom <= result.viewport[1] + 1, `${name} fits vertically`);
          assert.ok(result.overflow <= 1, `${name} has no horizontal overflow: ${result.overflow}`);
        }
      }
      await capture('chat');
      await page.locator('#toggle-people-drawer').click();
      await capture('members');
      await page.locator('.role-prompt-detail').first().click();
      await capture('persona');
      await page.locator('.role-prompt-close').click();
      await page.locator('#close-people-drawer').click();
      await page.locator('#toggle-people-drawer').click();
      await page.locator('#add-role-form button[type=submit]').click();
      await capture('add-person');
      await page.locator('#open-temporary-person').click();
      await capture('temporary-person');
      await page.locator('#close-temporary-person').click();
      await page.locator('#close-add-person').click();
      await (await sidebarItem(page, '#open-people-library')).click();
      await capture('people');
      await page.locator('#people-library-tab-builtin').click();
      await capture('people-builtin');
      await page.locator('#people-library-search').fill('no-matching-person-xyz');
      await capture('people-empty');
      await page.locator('#people-library-search').fill('');
      await page.locator('#new-template').click();
      await capture('person-editor');
      await page.locator('#close-person-template').click();
      await page.locator('#close-people-library').click();
      await closeDrawer(page);
      await (await sidebarItem(page, '#open-external-models')).click();
      await capture('models');
      await page.locator('#close-external-models').click();
      await closeDrawer(page);
      await page.locator('#toggle-notes-panel').click();
      await capture('notes');
      await page.locator('#close-notes-panel').click();
      await (await sidebarItem(page, '#open-all-notes')).click();
      await page.locator('#all-notes-editor [contenteditable]').waitFor();
      await capture('all-notes');
      await page.locator('#close-all-notes').click();
      await (await sidebarItem(page, '#quick-create-chat')).click();
      await capture('create-chat');
      await page.locator('#open-group-template-create').click();
      await capture('group-templates');
      await page.locator('#close-group-template-modal').click();
      await page.locator('#cancel-create-chat').click();
      if (width <= (baseline ? 720 : 960)) await page.keyboard.press('Escape');
      await page.locator('#open-orchestration').click();
      await capture('orchestration');
      await page.locator('#open-orchestration-template').click();
      await capture('orchestration-templates');
      await page.locator('.orchestration-template-card:not(:disabled)').first().click();
      await capture('orchestration-flow');
      if (!baseline) {
        await page.locator('.orchestration-stage-canvas [data-stage-id][role="button"]').first().press('Enter');
        await capture('orchestration-node-settings');
        await page.locator('.orchestration-node-editor-close').click();
      }
      await page.locator('#auto-orchestration').click();
      await capture('auto-orchestration');
      await page.locator('#close-auto-orchestration').click();
      await page.locator('#close-orchestration').click();
      await page.locator('#error').waitFor({ state: 'hidden' });
      await (await sidebarItem(page, '#settings-button')).click();
      await capture('settings');
      await page.locator('#toggle-window-size').click();
      await page.locator('#window-launcher').waitFor();
      await capture('provider-windows');
      await page.locator('#window-launcher').click();
      await page.locator('#chat-title').waitFor();
      assert.deepEqual(errors, [], 'no JavaScript errors');
      if (!baseline) assert.deepEqual([...allTells], [], 'every screen uses flat design-system surfaces');
    } finally { await browser.close(); }
  }
  await writeFile(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
});

test('keyboard navigation, stacked dialogs and workflow nodes preserve focus', { skip: baseline, timeout: 30000 }, async () => {
  const { browser, page, errors } = await openFixture({ viewport: { width: 375, height: 812 } });
  try {
    page.setDefaultTimeout(5000);
    const focused = selector => page.locator(selector).evaluate(el => el === document.activeElement);
    await page.locator('#toggle-chat-sidebar').press('Enter');
    assert.equal(await page.locator('#toggle-chat-sidebar').getAttribute('aria-expanded'), 'true');
    assert.ok(await focused('.chat-item.active .chat-name'));
    await page.locator('.chat-menu-btn').first().press('Enter');
    await page.locator('.chat-action-menu').waitFor();
    assert.equal(await page.locator('#toggle-chat-sidebar').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    await page.locator('.chat-action-menu').waitFor({ state: 'detached' });
    await page.locator('.chat-item.active .chat-name').press('Enter');
    assert.equal(await page.locator('#toggle-chat-sidebar').getAttribute('aria-expanded'), 'false');
    assert.ok(await focused('#toggle-chat-sidebar'));

    await page.locator('#toggle-chat-sidebar').press('Enter');
    await page.locator('#open-people-library').press('Enter');
    assert.equal(await page.locator('#app').evaluate(el => el.inert), true);
    await page.locator('#new-template').focus();
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.locator('#people-library-modal').evaluate(el => el.contains(document.activeElement)));
    await page.locator('#new-template').press('Enter');
    assert.equal(await page.locator('#people-library-modal').evaluate(el => el.inert), true);
    await page.keyboard.press('Escape');
    await page.locator('#person-template-modal').waitFor({ state: 'hidden' });
    assert.ok(await focused('#new-template'), 'closing the editor restores the library trigger');
    await page.locator('#people-library-tab-custom').press('ArrowRight');
    assert.equal(await page.locator('#people-library-tab-builtin').getAttribute('aria-selected'), 'true');
    assert.ok(await focused('#people-library-tab-builtin'));
    await page.keyboard.press('Escape');
    assert.ok(await focused('#open-people-library'));
    assert.equal(await page.locator('#toggle-chat-sidebar').getAttribute('aria-expanded'), 'true', 'Escape closes only the dialog');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#toggle-chat-sidebar').getAttribute('aria-expanded'), 'false');

    await page.locator('#open-orchestration').press('Enter');
    await page.locator('.orchestration-stage-canvas .x6-graph-svg').waitFor({ state: 'attached' });
    await page.locator('.orchestration-person').first().press('Enter');
    await page.locator('.orchestration-person').nth(1).press('Enter');
    const node = page.locator('.orchestration-stage-canvas [data-stage-id][role="button"]').first();
    await node.waitFor();
    await node.press('Enter');
    await page.locator('.orchestration-node-editor-header').waitFor();
    assert.ok(await focused('#orchestration-stage-settings [data-stage-kind]'));
    const editor = page.locator('#orchestration-stage-settings');
    await editor.locator('[data-stage-kind]').selectOption('review');
    await editor.getByLabel('Review outcome').selectOption('fail');
    await editor.locator('#stage-connection-target').selectOption({ label: 'Engineer' });
    await editor.getByRole('button', { name: 'Connect', exact: true }).press('Enter');
    assert.match(await editor.locator('.stage-connection-list').innerText(), /Engineer · Fail/);
    // X6 draws the edge asynchronously.
    await page.locator('.orchestration-stage-canvas .x6-edge').waitFor();
    assert.equal(await page.locator('.orchestration-stage-canvas .x6-edge').count(), 1);
    await editor.getByRole('button', { name: 'Remove connection to Engineer' }).press('Enter');
    assert.equal(await page.locator('.orchestration-stage-canvas .x6-edge').count(), 0);
    await page.keyboard.press('Escape');
    assert.ok(await focused('#open-orchestration'));
    await page.locator('#toggle-chat-sidebar').press('Enter');
    await page.locator('#settings-button').press('Enter');
    await page.locator('#toggle-fullscreen').press('Enter');
    assert.equal(await page.locator('#toggle-fullscreen').getAttribute('aria-pressed'), 'true');
    await page.locator('#toggle-fullscreen').press('Enter');
    await page.locator('#toggle-window-size').press('Enter');
    await page.locator('#window-launcher').waitFor();
    await page.locator('#window-launcher').press('Enter');
    await page.locator('#app').waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('chat feedback, theme contrast and touch targets work at extreme widths', { skip: baseline, timeout: 30000 }, async () => {
  const { browser, page, seed, errors } = await openFixture();
  try {
    page.setDefaultTimeout(5000);
    for (const [width, height, theme] of [[320, 640, 'dark'], [768, 800, 'light'], [1440, 960, 'dark']]) {
      await page.setViewportSize({ width, height });
      await (await sidebarItem(page, '#settings-button')).click();
      await page.locator(`#theme-${theme}`).click();
      await page.keyboard.press('Escape');
      await closeDrawer(page);
      const metrics = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const luminance = token => {
          let hex = style.getPropertyValue(token).trim().slice(1);
          if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
          return hex.match(/../g).map(value => parseInt(value, 16) / 255)
            .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        };
        const contrast = (a, b) => {
          const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
          return (values[0] + .05) / (values[1] + .05);
        };
        return {
          ratio: Math.min(...[
            ['--text', '--panel'], ['--muted', '--panel'], ['--muted', '--panel-soft'],
            ['--brand', '--brand-deep'], ['--on-brand', '--brand'], ['--text', '--panel-soft'],
            ['--warning', '--warning-bg'], ['--danger', '--danger-bg'],
          ].map(([a, b]) => contrast(a, b))),
          width: document.querySelector('.app-shell').scrollWidth,
          targets: [...document.querySelectorAll('.rail-btn, #attach-file, #send-message, #toggle-chat-sidebar')]
            .filter(el => el.checkVisibility())
            .map(el => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)),
        };
      });
      assert.ok(metrics.ratio >= 4.5, `${theme} text token contrast: ${metrics.ratio}`);
      assert.ok(metrics.width <= width, `app fits ${width}px`);
      assert.ok(metrics.targets.every(size => size >= 44), `main targets fit ${width}px`);
      await page.mouse.move(1, 1);
      await page.screenshot({ path: path.join(output, `${width}-${theme}-chat.png`) });
    }
    assert.equal(await page.locator('#mention-teammate').count(), 0, 'no separate @ button; typing @ opens the list');
    await page.locator('#message-input').click();
    await page.keyboard.type('@');
    await page.locator('#mention-panel').waitFor();
    await page.locator('#message-input').fill('@Engineer Check the signup flow');
    // The send target stays as the draft's description for assistive tech but is never shown as a hint.
    assert.match(await page.locator('#target-preview').textContent(), /Engineer/);
    assert.equal(await page.locator('.composer-feedback').isVisible(), false);
    await page.locator('#message-input').fill('');
    seed.chatsById.chat.status = 'running';
    seed.messagesById.answer2.status = 'pending';
    seed.messagesById.answer2.content = '';
    seed.rolesById.engineer.status = 'thinking';
    seed.rolesById.engineer.updatedAt = Date.now();
    await page.evaluate(store => window.__fixturePush({ type: 'GROUP_STORE_UPDATED', store }), seed);
    await page.locator('.thinking-dots').first().waitFor();
    await page.screenshot({ path: path.join(output, '1440-dark-loading.png') });
    await page.evaluate(() => window.__fixturePush({ type: 'GROUP_DELIVERY_ERROR', error: 'Could not connect to the model. Restore the session and try again.' }));
    await page.locator('#error').waitFor();
    await page.screenshot({ path: path.join(output, '1440-dark-error.png') });
    await page.evaluate(store => {
      store.chatsById = {};
      store.chatOrder = [];
      delete store.currentChatId;
      window.__fixturePush({ type: 'GROUP_STORE_UPDATED', store });
    }, seed);
    await page.locator('.messages .empty-state').waitFor();
    await page.locator('#error').waitFor({ state: 'hidden', timeout: 7000 });
    await page.screenshot({ path: path.join(output, '1440-dark-empty.png') });
    await page.locator('.messages .empty-card .btn-primary').click();
    await page.locator('#create-chat-form').waitFor();
    assert.ok(await page.locator('#new-chat-name').evaluate(el => el === document.activeElement));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
