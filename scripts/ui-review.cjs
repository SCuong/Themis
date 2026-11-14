// Real unpacked-extension UI review in an isolated profile. No personal storage, sign-ins or provider requests.
// npm run build && node scripts/ui-review.cjs [--open]
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { buildSeed } = require('../ui-fixture.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-results', 'ui-review');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'profile-'));
  const preview = process.argv.includes('--open');
  const extension = path.join(root, 'dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: !preview, viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
  // The UI and background are real. External frames are inert to protect accounts and quota.
  await context.route(/^https?:\/\//, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Isolated provider frame</title>',
  }));
  const expectedWorker = worker => worker.url().startsWith('chrome-extension://cnccbifloajlkjglmiojkpimjciamlpe/');
  const worker = context.serviceWorkers().find(expectedWorker) || await context.waitForEvent('serviceworker', { predicate: expectedWorker });
  let storageReady = false;
  for (let attempt = 0; attempt < 50 && !storageReady; attempt++) {
    storageReady = await worker.evaluate(() => typeof globalThis.chrome?.storage?.local?.set === 'function');
    if (!storageReady) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(storageReady, 'Extension storage API initialized');
  const id = new URL(worker.url()).host;
  const seed = await buildSeed({ language: 'vi', prepare(store) {
    const long = '\n\n## Điều kiện ra mắt\n\n' +
      'Giữ trải nghiệm rõ ràng, kiểm tra khả năng phục hồi và bảo toàn lịch sử hội thoại. '.repeat(24) +
      '\n\n```typescript\nawait syncFrameRules(tabId, members);\nframe.src = siteUrl(member);\nconst deliberatelyLongIdentifier = "a-long-line-that-must-scroll-inside-the-code-block-without-widening-the-conversation";\n```\n\n' +
      '| Hạng mục | Chủ sở hữu | Điều kiện hoàn thành |\n| --- | --- | --- |\n| Gửi tin | Kỹ thuật | Kiểm thử trên từng website |\n| Trải nghiệm | Thiết kế | Kiểm tra sáng, tối và cửa sổ hẹp |\n\n' +
      '> Ý kiến phản biện cần được đọc cùng ngữ cảnh gốc.\n\n[Hướng dẫn](https://example.invalid) · `inline_code` · **Tiếng Việt đầy đủ dấu**.';
    store.messagesById.answer2.content += long;
    store.globalNote = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Chuẩn bị ra mắt' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Một nơi để lưu những điều nhóm đã thống nhất.' }] },
    ] };
    store.settings.externalModelOrder = ['review'];
    store.settings.externalModelsById.review = {
      id: 'review', name: 'Local review model', format: 'openai',
      baseUrl: 'https://example.invalid/v1', apiKey: 'isolated-review-key', modelName: 'review-only',
    };
  } });
  await worker.evaluate(store => chrome.storage.local.set({ 'themis.groupStore': store }), seed);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/team.html`);
  await page.locator('#chat-title').filter({ hasText: 'Product launch' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const measurements = [];
  async function shot(name) {
    await page.mouse.move(1, 1);
    const metrics = await page.evaluate(() => {
      const visible = s => [...document.querySelectorAll(s)].filter(el => el.checkVisibility());
      const surface = visible('[role="dialog"]').at(-1) || visible('.role-panel.open, .notes-panel.open').at(-1) || document.getElementById('app');
      const b = surface.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom,
        overflow: surface.scrollWidth - surface.clientWidth, viewport: [innerWidth, innerHeight] };
    });
    assert(metrics.left >= -1 && metrics.right <= metrics.viewport[0] + 1, `${name}: horizontal bounds`);
    assert(metrics.top >= -1 && metrics.bottom <= metrics.viewport[1] + 1, `${name}: vertical bounds`);
    assert(metrics.overflow <= 1, `${name}: overflow ${metrics.overflow}`);
    measurements.push({ name, ...metrics });
    await page.screenshot({ path: path.join(output, name + '.png') });
  }
  async function sidebar(selector) {
    if (!(await page.locator(selector).isVisible())) await page.locator('#toggle-chat-sidebar').click();
    return page.locator(selector);
  }
  async function dismissSidebar() {
    if (await page.locator('#close-chat-sidebar').isVisible()) await page.keyboard.press('Escape');
  }
  async function appearance(theme, language) {
    await (await sidebar('#settings-button')).click();
    await page.locator('#theme-' + theme).click();
    await page.locator('#language-' + language).click();
    await page.keyboard.press('Escape');
    await dismissSidebar();
  }
    for (const [width, theme, language] of [[1440, 'light', 'vi'], [1440, 'dark', 'en'], [375, 'light', 'en'], [375, 'dark', 'vi']]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 960 });
      await appearance(theme, language);
      const tag = `${width}-${theme}-${language}`;
      await page.locator('#messages').evaluate(el => { el.scrollTop = 0; });
      await shot(tag + '-chat');
      await page.locator('.message-body pre').scrollIntoViewIfNeeded();
      await shot(tag + '-markdown');
      assert(await page.locator('.message-body pre').evaluate(el => el.scrollWidth > el.clientWidth), 'long code scrolls locally');
      await page.locator('#message-input').fill('@');
      await page.locator('#mention-panel').waitFor();
      await shot(tag + '-mentions');
      await page.keyboard.press('Escape');
      await page.locator('#message-input').fill('');
      await page.locator('#toggle-people-drawer').click();
      await shot(tag + '-members');
      await page.locator('.role-panel .role-site-control > button').first().click();
      await page.locator('.role-panel .role-site-menu').waitFor();
      await shot(tag + '-model-picker');
      await page.locator('.role-panel .role-site-option.active').click();
      await page.locator('.role-prompt-detail').first().click();
      await shot(tag + '-persona');
      await page.locator('.role-prompt-close').click();
      await page.locator('#close-people-drawer').click();
      await (await sidebar('#open-people-library')).click();
      await shot(tag + '-people');
      await page.locator('#people-library-tab-builtin').click();
      await shot(tag + '-people-builtin');
      await page.locator('#people-library-search').fill('no-matching-person-review');
      await shot(tag + '-people-empty');
      await page.locator('#people-library-search').fill('');
      await page.locator('#new-template').click();
      await shot(tag + '-person-editor');
      await page.locator('#close-person-template').click();
      await page.locator('#close-people-library').click();
      await dismissSidebar();
      await (await sidebar('#open-external-models')).click();
      await shot(tag + '-models');
      await page.locator('#close-external-models').click();
      await dismissSidebar();
      await page.locator('#toggle-notes-panel').click();
      await page.locator('#notes-editor .ProseMirror').waitFor();
      await shot(tag + '-notes');
      await page.locator('#close-notes-panel').click();
      await (await sidebar('#open-all-notes')).click();
      await page.locator('#all-notes-editor .ProseMirror').waitFor();
      await shot(tag + '-all-notes');
      await page.locator('#close-all-notes').click();
      await dismissSidebar();
      await page.locator('#open-orchestration').click();
      await page.locator('.x6-graph-svg').waitFor({ state: 'attached' });
      await page.locator('.orchestration-person').first().click();
      await page.locator('.orchestration-person').nth(1).click();
      await page.locator('.orchestration-stage-canvas [data-stage-id][role="button"]').first().waitFor({ state: 'attached' });
      await shot(tag + '-workflow');
      await page.locator('.orchestration-stage-canvas [data-stage-id][role="button"]').first().press('Enter');
      await shot(tag + '-workflow-settings');
      assert.match(await page.locator('#orchestration-stage-settings').innerText(), language === 'vi' ? /Loại bước/ : /Node type/);
      await page.locator('.orchestration-node-editor-close').click();
      await page.locator('#auto-orchestration').click();
      await shot(tag + '-auto-workflow');
      await page.locator('#close-auto-orchestration').click();
      await page.locator('#close-orchestration').click();
      await page.locator('#composer-file-input').setInputFiles({
        name: 'review.md', mimeType: 'text/markdown', buffer: Buffer.from('# Ghi chú kiểm thử\n\nNội dung đính kèm trong profile riêng.\n\n- Tiếng Việt\n- Định dạng Markdown'),
      });
      await page.locator('#composer-files .file-tile-open').first().click();
      await page.locator('.file-viewer-markdown h1').waitFor();
      await shot(tag + '-file-viewer');
      await page.keyboard.press('Escape');
      await page.locator('#composer-files .file-tile-remove').first().click();
      await (await sidebar('#settings-button')).click();
      await shot(tag + '-settings');
      await page.keyboard.press('Escape');
      await dismissSidebar();
    }
    // Save and reload through the real background service worker, without addressing any AI.
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('#message-input').fill('Ghi chú kiểm tra giao diện, không gửi tới thành viên.');
    await page.locator('#send-message').click();
    await page.getByText('Ghi chú kiểm tra giao diện, không gửi tới thành viên.', { exact: true }).waitFor();
    await page.locator('#toggle-notes-panel').click();
    await page.locator('#notes-editor .ProseMirror').fill('Ghi chú được lưu trong profile kiểm thử riêng.');
    await page.evaluate(async () => {
      for (let attempt = 0; attempt < 80; attempt++) {
        const result = await chrome.runtime.sendMessage({ type: 'GROUP_STORE_GET' });
        if (JSON.stringify(result.store.chatNotesById).includes('profile kiểm thử riêng')) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('The note did not reach extension storage');
    });
    await page.locator('#close-notes-panel').click();
    await page.reload();
    await page.getByText('Ghi chú kiểm tra giao diện, không gửi tới thành viên.', { exact: true }).waitFor();
    const saved = await page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GROUP_STORE_GET' })).store);
    const localMessage = Object.values(saved.messagesById).find(m => m.content === 'Ghi chú kiểm tra giao diện, không gửi tới thành viên.');
    assert.equal(localMessage.targetRoleIds.length, 0, 'no provider prompt was sent');
    assert(JSON.stringify(saved.chatNotesById).includes('profile kiểm thử riêng'), 'note survives reload');
    assert.equal(Object.keys(saved.messagesById).filter(key => key in seed.messagesById).length, 3, 'original history preserved');
    assert.deepEqual(errors, [], 'no application JavaScript errors');
    await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({ extensionId: id, errors, measurements, checks: ['real extension', 'both themes', 'both languages', '1440 and 375', 'local-only send', 'note persistence', 'history preserved'] }, null, 2));
    console.log(`UI review passed: ${measurements.length} screenshots. ${output}`);
    if (preview) { console.log('Isolated review window left open. Close it to end.'); await new Promise(resolve => context.on('close', resolve)); }
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
