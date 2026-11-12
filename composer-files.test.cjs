const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { openFixture } = require('./ui-fixture.cjs');

// 1x1 PNG so the image tile has a real thumbnail.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const shot = name => path.join(__dirname, 'test-results', name);

test('attachments preview as tiles, open in the viewer, go out with the message and stay viewable', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openFixture();
  try {
    await page.locator('#composer-file-input').setInputFiles([
      { name: 'brief.md', mimeType: 'text/markdown', buffer: Buffer.from('# Brief\nShip it.') },
      { name: 'photo.png', mimeType: 'image/png', buffer: PNG },
      { name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2') },
    ]);
    await page.locator('#composer-files .file-tile').nth(2).waitFor();
    assert.equal(await page.locator('#composer-files .file-tile.is-visual img').count(), 1, 'image gets a thumbnail');

    // The corner remove button appears on hover and is a 44px target.
    const csv = page.locator('#composer-files .file-tile').nth(2);
    await csv.hover();
    const remove = await csv.locator('.file-tile-remove').boundingBox();
    assert.ok(remove.width >= 44 && remove.height >= 44);
    await page.screenshot({ path: shot('composer-files-desktop.png') });
    await csv.locator('.file-tile-remove').click();
    assert.equal(await page.locator('#composer-files .file-tile').count(), 2);

    // Clicking a tile opens the side viewer; Escape closes it and returns focus.
    await page.locator('#composer-files .file-tile-open').first().click();
    // .md files render as markdown: the # line becomes a heading, not raw text.
    await page.locator('.file-viewer:not([hidden]) .file-viewer-markdown h1').filter({ hasText: 'Brief' }).waitFor();
    await page.screenshot({ path: shot('composer-files-viewer.png') });
    const shell = await page.locator('.app-shell').boundingBox();
    const panel = await page.locator('.file-viewer').boundingBox();
    assert.ok(shell.x + shell.width <= panel.x + 1, 'the chat is pushed left of the viewer, not covered');
    assert.equal(await page.locator('.app-shell').evaluate(node => node.classList.contains('sidebar-collapsed')), true, 'sidebar folds while a file is open');
    assert.equal(await page.locator('.file-viewer-body').evaluate(node => getComputedStyle(node).backgroundColor), await page.locator('.file-viewer').evaluate(node => getComputedStyle(node).backgroundColor), 'viewer body is plain panel white');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.file-viewer').isHidden(), true);
    assert.equal(await page.locator('.app-shell').evaluate(node => node.classList.contains('sidebar-collapsed')), false, 'sidebar comes back after closing');
    assert.equal(Math.round((await page.locator('.app-shell').boundingBox()).width), 1440);

    await page.locator('#message-input').fill('@Everyone đọc tệp này');
    await page.locator('#send-message').click();
    await page.locator('#composer-files').waitFor({ state: 'hidden' });
    const sent = (await page.evaluate(() => window.__fixtureCommands)).find(command => command.type === 'GROUP_MESSAGE_SEND');
    assert.deepEqual(sent.files.map(file => file.name), ['brief.md', 'photo.png']);
    assert.equal(Buffer.from(sent.files[0].dataUrl.split(',')[1], 'base64').toString(), '# Brief\nShip it.');
    assert.ok(sent.files.every(file => typeof file.id === 'string'));

    // A sent message reloads its files from local storage, so the image thumbnail and viewer still work.
    await page.evaluate(files => document.querySelector('.message-row').append(globalThis.themisComposerFiles.messageFiles({ files })), sent.files.map(({ id, name, type, size }) => ({ id, name, type, size })));
    await page.locator('.message-files .file-tile.is-visual img').waitFor();
    await page.locator('.message-files .file-tile.is-visual .file-tile-open').click();
    await page.locator('.file-viewer:not([hidden]) .file-viewer-body img').waitFor();
    await page.keyboard.press('Escape');

    // Dropping a file on the conversation attaches it instead of opening it.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(['dropped'], 'dropped.txt', { type: 'text/plain' }));
      const target = document.querySelector('.message-row');
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
    });
    await page.locator('#composer-files .file-tile').filter({ hasText: 'dropped.txt' }).waitFor();
    assert.equal(await page.evaluate(() => document.getElementById('composer').classList.contains('is-file-drop')), false);
    assert.equal(page.url(), 'https://themis.test/team.html');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('#composer-file-input').setInputFiles([{ name: 'a-very-long-file-name-for-the-narrow-composer.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2048) }]);
    await page.locator('#composer-files .file-tile').nth(1).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'tiles must not overflow a narrow viewport');
    const attach = await page.locator('#attach-file').boundingBox();
    assert.ok(attach.width >= 44 && attach.height >= 44, 'attach button must be a 44px touch target');
    await page.screenshot({ path: shot('composer-files-mobile.png') });
    await page.locator('#composer-files .file-tile-open').nth(1).click();
    const viewer = await page.locator('.file-viewer').boundingBox();
    assert.ok(viewer.x >= 0 && viewer.width <= 375, 'viewer fills the narrow screen without overflow');
    await page.screenshot({ path: shot('composer-files-viewer-mobile.png') });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('the viewer renders Markdown and DOCX under the extension CSP', { timeout: 60000 }, async () => {
  const fs = require('node:fs');
  const { browser, page, errors } = await openFixture();
  const cspErrors = [];
  page.on('console', message => { if (/Content Security Policy/.test(message.text())) cspErrors.push(message.text()); });
  try {
    // Serve team.html with the manifest's CSP: it blocks fetch() of blob: URLs, which a plain fixture would not catch.
    const csp = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')).content_security_policy.extension_pages;
    await page.route('https://themis.test/team.html', route => route.fulfill({ body: fs.readFileSync(path.join(__dirname, 'team.html')), contentType: 'text/html', headers: { 'content-security-policy': csp } }));
    await page.reload();
    await page.locator('#chat-title').filter({ hasText: 'Product launch' }).waitFor();
    await page.locator('#composer-file-input').setInputFiles([
      { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>') },
      { name: 'Bao cao.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fs.readFileSync(path.join(__dirname, 'test-fixtures/sample.docx')) },
    ]);
    const tiles = page.locator('#composer-files .file-tile-open');
    await tiles.nth(0).click();
    await page.locator('.file-viewer-markdown table').waitFor();
    assert.equal(await page.locator('.file-viewer-markdown script').count(), 0, 'HTML in a Markdown file stays text');
    await page.keyboard.press('Escape');

    await tiles.nth(1).click();
    await page.locator('.file-viewer-markdown h1').filter({ hasText: 'Báo cáo PBL3' }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.file-viewer-markdown li').count(), 2);
    assert.equal(await page.locator('.file-viewer-markdown strong').first().textContent(), 'Đề xuất');
    assert.equal(await page.locator('.file-viewer-meta').textContent(), '36 KB · DOCX');
    await page.screenshot({ path: shot('composer-files-docx.png') });
    assert.deepEqual(cspErrors, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
