// Data integrity: notes survive a fast scope/chat switch (#1), Retry keeps the message's files (#6),
// and a finished send leaves the next draft's files alone (#7).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { startThemis } = require('./prompt-sync-harness.cjs');
const { openFixture } = require('./ui-fixture.cjs');

// ---------- #6: Retry keeps the files of the original message ----------

const dataUrl = text => `data:text/plain;base64,${Buffer.from(text).toString('base64')}`;
const textOf = file => Buffer.from(file.dataUrl.split(',')[1], 'base64').toString();
let fileCount = 0;

// The team page's composer file store, which the service worker shares (same extension origin).
function composerFiles(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('themis.composerFiles', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const transaction = open.result.transaction('files', mode);
      action(transaction.objectStore('files'));
      transaction.oncomplete = () => { open.result.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

// What the composer does on attach: keep the bytes in IndexedDB and hand the message a data URL.
async function attach(name, text) {
  const id = `file-test-${++fileCount}`;
  await composerFiles('readwrite', store => store.put({ id, name, type: 'text/plain', size: text.length, blob: new Blob([text], { type: 'text/plain' }), createdAt: 1 }));
  return { id, name, type: 'text/plain', size: text.length, dataUrl: dataUrl(text) };
}

const siteRoles = () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const roleError = (team, sent, roleId, reason) => team.send({ type: 'TEAM_ROLE_ERROR', chatId: 'chat', roleId, messageId: sent.messageId, replyAttemptId: sent.byRole[roleId].replyAttemptId, reason }, roleId);

test('#6 Retry sends the original message files again, read back from IndexedDB', async () => {
  const team = await startThemis({ mode: 'independent', roles: siteRoles() });
  const files = [await attach('first.txt', 'first file body'), await attach('second.txt', 'second file body')];
  const sent = await team.user('Read these', { files });
  assert.deepEqual(sent.byRole.a.files.map(textOf), ['first file body', 'second file body'], 'the first send carries the files');

  await team.ack('a', sent.messageId);
  await roleError(team, sent, 'a', 'Stopped by the user');
  const retried = await team.retry('a', sent.messageId);
  assert.deepEqual((retried.files ?? []).map(file => file.name), ['first.txt', 'second.txt']);
  assert.deepEqual(retried.files.map(textOf), ['first file body', 'second file body']);
  assert.match(retried.content, /Read these/);
});

test('#6 Retry of a replied message (regenerate) also carries the files', async () => {
  const team = await startThemis({ mode: 'independent', roles: siteRoles() });
  const sent = await team.user('Read this', { files: [await attach('report.txt', 'report body')] });
  await team.ack('a', sent.messageId);
  await team.reply('a', sent.byRole.a, 'Done', 'c-a');
  const retried = await team.retry('a', sent.messageId);
  assert.deepEqual((retried.files ?? []).map(textOf), ['report body']);
});

test('#6 Retry refuses to send when a file is gone, and changes nothing', async () => {
  const team = await startThemis({ mode: 'independent', roles: siteRoles() });
  const files = [await attach('kept.txt', 'kept'), await attach('lost.txt', 'lost')];
  const sent = await team.user('Read these', { files });
  await team.ack('a', sent.messageId);
  await team.reply('a', sent.byRole.a, 'Earlier answer', 'c-a');
  await composerFiles('readwrite', store => store.delete(files[1].id));

  const before = await team.store();
  const promptCount = team.prompts.length;
  const response = await team.send({ type: 'GROUP_ROLE_RETRY_REPLY', chatId: 'chat', roleId: 'a', messageId: sent.messageId });
  assert.equal(response.ok, false);
  assert.match(response.error, /lost\.txt/, 'the error names the missing file');
  assert.equal(team.prompts.length, promptCount, 'no prompt goes out without its file');
  const after = await team.store();
  assert.equal(after.rolesById.a.status, before.rolesById.a.status, 'the member is not left thinking');
  assert.deepEqual(after.chatsById.chat.messageIds, before.chatsById.chat.messageIds, 'the earlier answer is not discarded');
  assert.deepEqual(after.messagesById[sent.messageId].deliveryStatus, before.messagesById[sent.messageId].deliveryStatus);
});

test('#6 the automatic retry after a provider error keeps the files, and does not run without them', async () => {
  const team = await startThemis({ mode: 'independent', roles: siteRoles() });
  const files = [await attach('auto.txt', 'auto body')];
  const sent = await team.user('Read this', { files });
  await team.ack('a', sent.messageId);
  await team.ack('b', sent.messageId);
  const promptCount = team.prompts.length;

  const retried = await roleError(team, sent, 'a', 'Network error'); // waits out the 2 s retry delay
  assert.equal(retried.retried, true);
  const again = team.prompts.slice(promptCount).find(prompt => prompt.roleId === 'a');
  assert.deepEqual((again.files ?? []).map(textOf), ['auto body']);

  await composerFiles('readwrite', store => store.delete(files[0].id));
  const failed = await roleError(team, sent, 'b', 'Network error');
  assert.notEqual(failed.retried, true, 'no automatic retry without the file');
  assert.equal(team.prompts.slice(promptCount).some(prompt => prompt.roleId === 'b'), false);
  assert.equal((await team.role('b')).status, 'error');
});

test('#6 Retry for an API model puts the file text back into the prompt', async () => {
  const realFetch = global.fetch;
  const bodies = [];
  const sse = `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'demo', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
  global.fetch = async (url, init) => { bodies.push(String(init.body)); return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
  try {
    const team = await startThemis({ mode: 'independent', roles: [{ id: 'a', name: 'A', notReady: true }] });
    const created = await team.send({ type: 'EXTERNAL_MODEL_CREATE', name: 'Api', format: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'test-key', modelName: 'demo' });
    const switched = await team.send({ type: 'GROUP_ROLE_UPDATE', chatId: 'chat', roleId: 'a', patch: { modelSource: 'external', externalModelId: created.model.id } });
    assert.notEqual(switched.ok, false, switched.error);
    const response = await team.send({ type: 'GROUP_MESSAGE_SEND', chatId: 'chat', raw: '@all Read this', files: [await attach('api.txt', 'api file body')] });
    assert.equal(response.ok, true, response.error);
    assert.match(bodies.at(-1), /api file body/, 'the first send inlines the file');

    const count = bodies.length;
    const retry = await team.send({ type: 'GROUP_ROLE_RETRY_REPLY', chatId: 'chat', roleId: 'a', messageId: response.message.id });
    assert.equal(retry.ok, true, retry.error);
    assert.equal(bodies.length, count + 1);
    assert.match(bodies.at(-1), /api file body/, 'the retry inlines the file again');
  } finally { global.fetch = realFetch; }
});

// ---------- UI fixture: the built team page in Chrome with a fake chrome.runtime ----------

// Holds the reply to every runtime message of `type` until the returned release() is called.
async function hold(page, type) {
  await page.evaluate(type => {
    window.__held = [];
    window.__fixtureHold = message => message.type === type ? new Promise(resolve => window.__held.push(resolve)) : undefined;
  }, type);
  return override => page.evaluate(override => { window.__held.splice(0).forEach(resolve => resolve(override)); }, override);
}
const commands = (page, type) => page.evaluate(type => window.__fixtureCommands.filter(command => command.type === type), type);
const tiles = page => page.locator('#composer-files .file-tile').evaluateAll(nodes => nodes.map(node => node.querySelector('.file-tile-open').title.split(' · ')[0]));
const txt = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

async function sendWithFile(page, name, text) {
  await page.locator('#composer-file-input').setInputFiles([txt(name, `${name} body`)]);
  await page.locator('#composer-files .file-tile').filter({ hasText: name }).waitFor();
  await page.locator('#message-input').fill(text);
  await page.locator('#send-message').click();
}

// ---------- #7: a finished send must not remove the next draft's files ----------

test('#7 a file attached while a send is running stays in the composer for the next message', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openFixture();
  try {
    const release = await hold(page, 'GROUP_MESSAGE_SEND');
    await sendWithFile(page, 'first.txt', '@Everyone one');
    await page.waitForFunction(() => window.__held.length === 1);

    await page.locator('#composer-file-input').setInputFiles([txt('second.txt', 'second.txt body')]);
    await page.locator('#composer-files .file-tile').filter({ hasText: 'second.txt' }).waitFor();
    assert.deepEqual(await tiles(page), ['second.txt'], 'first.txt left with its message; only the new draft file shows');

    await release();
    await page.waitForFunction(() => document.getElementById('message-input').value === '');
    await page.waitForTimeout(100);
    assert.deepEqual(await tiles(page), ['second.txt'], 'the late reply of the first send must not clear second.txt');

    await page.locator('#message-input').fill('@Everyone two');
    await page.locator('#send-message').click();
    await page.waitForFunction(() => window.__held.length === 1);
    await release();
    await page.locator('#composer-files').waitFor({ state: 'hidden' });
    const sent = await commands(page, 'GROUP_MESSAGE_SEND');
    assert.deepEqual(sent.map(command => command.files.map(file => file.name)), [['first.txt'], ['second.txt']], 'each message carries exactly its own files');
    assert.equal(Buffer.from(sent[1].files[0].dataUrl.split(',')[1], 'base64').toString(), 'second.txt body');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('#7 a failed send gives its files back without dropping the ones added meanwhile', { timeout: 60000 }, async () => {
  const { browser, page } = await openFixture();
  try {
    const release = await hold(page, 'GROUP_MESSAGE_SEND');
    await sendWithFile(page, 'first.txt', '@Everyone one');
    await page.waitForFunction(() => window.__held.length === 1);
    await page.locator('#composer-file-input').setInputFiles([txt('second.txt', 'second.txt body')]);
    await page.locator('#composer-files .file-tile').filter({ hasText: 'second.txt' }).waitFor();

    await release({ ok: false, error: 'Delivery failed' });
    await page.locator('#composer-files .file-tile').filter({ hasText: 'first.txt' }).waitFor();
    assert.deepEqual(await tiles(page), ['first.txt', 'second.txt']);
    assert.equal(await page.locator('#message-input').inputValue(), '@Everyone one', 'the text draft comes back too');
  } finally { await browser.close(); }
});

// ---------- #1: pending note edits survive a scope switch, a chat switch and closing the panel ----------

const noteText = content => JSON.stringify(content);
async function openNotes(page) {
  await page.evaluate(() => document.getElementById('toggle-notes-panel').click());
  await page.locator('#notes-editor .ProseMirror').waitFor();
}
// Types and returns at once, well inside the 250 ms save debounce.
async function typeNote(page, text) {
  await page.locator('#notes-editor .ProseMirror').click();
  await page.keyboard.insertText(text);
}
const click = (page, selector) => page.evaluate(selector => document.querySelector(selector).click(), selector);
const secondChat = seed => {
  seed.chatsById.other = { ...seed.chatsById.chat, id: 'other', name: 'Other chat', roleIds: [], messageIds: [], nextMessageSeq: 1 };
  seed.chatOrder.push('other');
};

test('#1 text typed in the chat note is saved to that chat when the tab switches at once', { timeout: 60000 }, async () => {
  const { browser, page, errors } = await openFixture();
  try {
    await openNotes(page);
    await typeNote(page, 'chat-note-text');
    await click(page, '#global-note-tab');
    await typeNote(page, 'global-note-text');
    await click(page, '#chat-note-tab');
    assert.match(await page.locator('#notes-editor').textContent(), /chat-note-text/, 'the chat note shows what was typed');
    assert.doesNotMatch(await page.locator('#notes-editor').textContent(), /global-note-text/);

    await page.waitForTimeout(400);
    const saves = await commands(page, 'GROUP_NOTE_SAVE');
    const chatSaves = saves.filter(save => save.scope === 'chat');
    const globalSaves = saves.filter(save => save.scope === 'global');
    assert.ok(chatSaves.some(save => save.chatId === 'chat' && /chat-note-text/.test(noteText(save.content))), 'the chat text reached the chat note');
    assert.ok(globalSaves.some(save => /global-note-text/.test(noteText(save.content))), 'the global text reached the global note');
    assert.ok(chatSaves.every(save => !/global-note-text/.test(noteText(save.content))), 'no global text in the chat note');
    assert.ok(globalSaves.every(save => !/chat-note-text/.test(noteText(save.content))), 'no chat text in the global note');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('#1 switching back before the save is confirmed still shows the typed text', { timeout: 60000 }, async () => {
  const { browser, page } = await openFixture();
  try {
    await openNotes(page);
    const release = await hold(page, 'GROUP_NOTE_SAVE');
    await typeNote(page, 'unconfirmed-text');
    await click(page, '#global-note-tab');
    await click(page, '#chat-note-tab');
    assert.match(await page.locator('#notes-editor').textContent(), /unconfirmed-text/, 'the store has not answered yet, the editor must not show the old note');
    await release();
  } finally { await browser.close(); }
});

test('#1 switching chat or closing the panel before the debounce saves to the chat that was open', { timeout: 60000 }, async () => {
  const { browser, page } = await openFixture({ prepare: secondChat });
  try {
    await openNotes(page);
    await typeNote(page, 'first-chat-text');
    await page.locator('.chat-item').filter({ hasText: 'Other chat' }).click();
    await page.locator('#chat-title').filter({ hasText: 'Other chat' }).waitFor();
    await typeNote(page, 'other-chat-text');
    await click(page, '#close-notes-panel');

    const saves = await commands(page, 'GROUP_NOTE_SAVE');
    assert.ok(saves.some(save => save.chatId === 'chat' && /first-chat-text/.test(noteText(save.content))), 'saved to the first chat');
    assert.ok(saves.some(save => save.chatId === 'other' && /other-chat-text/.test(noteText(save.content))), 'closing the panel saves at once');
    assert.ok(saves.every(save => save.chatId !== 'other' || !/first-chat-text/.test(noteText(save.content))), 'nothing from the first chat lands in the other chat');
    assert.ok(saves.every(save => save.scope === 'chat'), 'nothing lands in the global note');
    // The store returned by the save must already name the new chat, or applying it switches back.
    const sent = await page.evaluate(() => window.__fixtureCommands.map(command => command.type));
    assert.ok(sent.indexOf('GROUP_CHAT_SWITCH') < sent.indexOf('GROUP_NOTE_SAVE'), 'the chat switch is sent before the note save');
  } finally { await browser.close(); }
});
