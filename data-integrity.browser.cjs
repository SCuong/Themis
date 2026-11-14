// Browser check of data integrity (BUG #1 notes, #6 retry files, #7 composer files) in the real built extension.
// Loads dist/ unpacked in Playwright's Chromium on a throwaway profile and drives team.html through its UI.
// The member is an API member backed by a FAKE OpenAI-compatible server started here (FIXTURE, not a real
// provider): every request is held until the script releases it, so the timing is chosen by the test.
//
//   npm run build && node data-integrity.browser.cjs
//
// Writes test-results/data-integrity-e2e/{summary.json,summary.md,trace.zip,*.png} (DATA_E2E_OUT=name picks
// another folder under test-results/). Not part of `npm test`.
// Two steps do not go through clicks: the fake model is registered with EXTERNAL_MODEL_CREATE (the form opens
// Chrome's host-permission prompt, which automation cannot answer), and the member's first prompt is sent with
// GROUP_MESSAGE_SEND (an API member stays `pending` until its first use, and the composer does not send to it).
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = process.env.DATA_E2E_DIST || path.join(__dirname, 'dist'); // another build, to record the behavior before a fix
const out = path.join(__dirname, 'test-results', process.env.DATA_E2E_OUT || 'data-integrity-e2e');
const profile = path.join(out, 'profile');

// ---- fake model server (fixture) ----------------------------------------------------------------
const held = []; // { text, res }
const requests = []; // prompt text of every request, in order
const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const text = (JSON.parse(raw || '{}').messages ?? []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    requests.push(text);
    held.push({ text, res });
  });
});
function release(text) {
  const next = held.shift();
  if (!next) throw new Error('no held request');
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  next.res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  next.res.write(chunk({ role: 'assistant', content: text }));
  next.res.write(chunk({}, 'stop'));
  next.res.end('data: [DONE]\n\n');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(check, what, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}

async function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const results = [];
  const pageErrors = [];
  try {
    const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://')) ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(`chrome-extension://${extensionId}/team.html`);
    await page.locator('#quick-create-chat').waitFor();

    const command = (type, payload = {}) => page.evaluate(([type, payload]) => new Promise(resolve => chrome.runtime.sendMessage({ type, ...payload }, resolve)), [type, payload]);
    const store = async () => (await command('GROUP_STORE_GET')).store;
    const shot = async name => { await page.screenshot({ path: path.join(out, `${name}.png`) }); return `${name}.png`; };
    const noteText = note => JSON.stringify(note ?? null);
    const storedFileIds = () => page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('themis.composerFiles', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const all = open.result.transaction('files').objectStore('files').getAllKeys(); all.onsuccess = () => { open.result.close(); resolve(all.result); }; };
    }));
    const deleteStoredFile = id => page.evaluate(id => new Promise((resolve, reject) => {
      const open = indexedDB.open('themis.composerFiles', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const tx = open.result.transaction('files', 'readwrite'); tx.objectStore('files').delete(id); tx.oncomplete = () => { open.result.close(); resolve(); }; };
    }), id);
    const tiles = () => page.locator('#composer-files .file-tile').evaluateAll(nodes => nodes.map(node => node.querySelector('.file-tile-open').title.split(' · ')[0]));
    const attach = (name, text) => page.locator('#composer-file-input').setInputFiles([{ name, mimeType: 'text/plain', buffer: Buffer.from(text) }]);

    async function createChat(name) {
      await page.locator('#quick-create-chat').click();
      await page.locator('#new-chat-name').fill(name);
      await page.locator('#create-chat-form button[type=submit]').click();
      await page.locator('#chat-title', { hasText: name }).waitFor();
      return (await store()).currentChatId;
    }
    const otherChatId = await createChat('Other chat');
    const chatId = await createChat('Data E2E');
    const created = await command('EXTERNAL_MODEL_CREATE', { name: 'FakeModel', format: 'openai', baseUrl, apiKey: 'fixture-key', modelName: 'fake' });
    if (!created?.ok) throw new Error(`model create failed: ${created?.error}`);

    // One member through the people drawer, switched to the fake API model from the member card.
    await page.locator('#toggle-people-drawer').click();
    await page.locator('#add-role-form button[type=submit]').click();
    await page.locator('#open-temporary-person').click();
    await page.locator('#temporary-person-name').fill('Alpha');
    await page.locator('#temporary-person-prompt').fill('A test member. Answer briefly.');
    await page.locator('#add-temporary-person-form button[type=submit]').click();
    await page.locator('#add-library-people-list .select-row', { hasText: 'Alpha' }).locator('> input[type=checkbox]').check();
    await page.locator('#add-library-people-form button[type=submit]').click();
    await page.locator('#role-list .role-card', { hasText: 'Alpha' }).waitFor({ state: 'attached' });
    if (!await page.locator('#role-list').isVisible()) await page.locator('#toggle-people-drawer').click();
    const card = page.locator('#role-list .role-card', { hasText: 'Alpha' });
    await card.locator('.role-site-control .site-pill').click();
    await card.locator('.role-site-option', { hasText: 'FakeModel' }).click();
    const alpha = await waitFor(async () => Object.values((await store()).rolesById).find(r => r.name === 'Alpha' && r.chatId === chatId && r.modelSource === 'external'), 'Alpha on the API model');
    if (await page.locator('#role-list').isVisible()) await page.locator('#toggle-people-drawer').click().catch(() => {});

    // First use of the member (see the header): not through the composer.
    command('GROUP_MESSAGE_SEND', { chatId, raw: '@Alpha [[prime]] hello' });
    await waitFor(() => held.length === 1, 'prime request');
    release('primed');
    await waitFor(async () => (await store()).rolesById[alpha.id].status === 'ready', 'Alpha ready');

    const chatMessages = async () => { const s = await store(); return s.chatsById[chatId].messageIds.map(id => s.messagesById[id]); };
    async function sendFromComposer(text) {
      await page.locator('#message-input').fill(text);
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator('#send-message').click();
    }
    const openNotes = async () => {
      if (!await page.locator('#notes-panel.open').count()) await page.evaluate(() => document.getElementById('toggle-notes-panel').click());
      await page.locator('#notes-editor .ProseMirror').waitFor();
    };
    const typeNote = async text => { await page.locator('#notes-editor .ProseMirror').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(text); };
    const editorText = () => page.locator('#notes-editor').textContent();

    async function scenario(name, fn) {
      if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return; // ONLY='bug6|bug7' runs a subset
      const entry = { name, status: 'FAIL', checks: [], screenshots: [] };
      results.push(entry);
      try { await fn(entry); entry.status = 'PASS'; } catch (error) {
        entry.error = String(error.stack ?? error);
        entry.screenshots.push(await shot(`${name}-error`).catch(() => 'no screenshot'));
      }
      while (held.length) release('cleanup');
      await sleep(300);
    }
    // Records the check; a failed check ends the scenario.
    const check = (entry, label, ok, detail) => { entry.checks.push({ label, ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) }); if (!ok) throw new Error(`${label}: ${JSON.stringify(detail)}`); };

    // ---- BUG #1: notes -------------------------------------------------------------------------
    await scenario('bug1-notes-scope-switch', async entry => {
      await openNotes();
      await typeNote('CHAT-NOTE-A ');
      await page.locator('#global-note-tab').click(); // well inside the 250 ms debounce
      await typeNote('GLOBAL-NOTE-G ');
      await page.locator('#chat-note-tab').click();
      check(entry, 'chat tab shows the chat text right after switching back', /CHAT-NOTE-A/.test(await editorText()) && !/GLOBAL-NOTE-G/.test(await editorText()), await editorText());
      entry.screenshots.push(await shot('bug1-chat-note-after-fast-switch'));
      await sleep(600);
      const s = await store();
      check(entry, 'store: chat note has the chat text only', /CHAT-NOTE-A/.test(noteText(s.chatNotesById?.[chatId])) && !/GLOBAL-NOTE-G/.test(noteText(s.chatNotesById?.[chatId])), noteText(s.chatNotesById?.[chatId]));
      check(entry, 'store: global note has the global text only', /GLOBAL-NOTE-G/.test(noteText(s.globalNote)) && !/CHAT-NOTE-A/.test(noteText(s.globalNote)), noteText(s.globalNote));
    });

    await scenario('bug1-notes-chat-switch', async entry => {
      await openNotes();
      await page.locator('#chat-note-tab').click();
      await typeNote('CHAT-NOTE-B ');
      await page.locator('.chat-item', { hasText: 'Other chat' }).click(); // before the debounce
      await page.locator('#chat-title', { hasText: 'Other chat' }).waitFor();
      await sleep(600);
      check(entry, 'the chat switch was not undone by the note save', (await page.locator('#chat-title').textContent()).includes('Other chat') && (await store()).currentChatId === otherChatId, await page.locator('#chat-title').textContent());
      check(entry, 'the other chat shows an empty note', !/CHAT-NOTE/.test(await editorText()), await editorText());
      let s = await store();
      check(entry, 'store: text went to the chat it was typed in', /CHAT-NOTE-A.*CHAT-NOTE-B/.test(noteText(s.chatNotesById?.[chatId])), noteText(s.chatNotesById?.[chatId]));
      check(entry, 'store: nothing leaked into the other chat or the global note', !/CHAT-NOTE-B/.test(noteText(s.chatNotesById?.[otherChatId])) && !/CHAT-NOTE-B/.test(noteText(s.globalNote)), [noteText(s.chatNotesById?.[otherChatId]), noteText(s.globalNote)]);
      await page.locator('.chat-item', { hasText: 'Data E2E' }).click();
      await page.locator('#chat-title', { hasText: 'Data E2E' }).waitFor();
      check(entry, 'back in the first chat the note shows both texts', /CHAT-NOTE-A.*CHAT-NOTE-B/.test(await editorText()), await editorText());
      entry.screenshots.push(await shot('bug1-note-after-chat-switch'));
    });

    await scenario('bug1-notes-close-and-reload', async entry => {
      await openNotes();
      await typeNote('CHAT-NOTE-C ');
      await page.locator('#close-notes-panel').click(); // closing inside the debounce saves at once
      await page.reload();
      await page.locator('#chat-title', { hasText: 'Data E2E' }).waitFor();
      check(entry, 'store after close + immediate reload has the text', /CHAT-NOTE-C/.test(noteText((await store()).chatNotesById?.[chatId])), noteText((await store()).chatNotesById?.[chatId]));
      await openNotes();
      await waitFor(async () => /CHAT-NOTE-C/.test(await editorText()), 'note text after reload');
      await typeNote('CHAT-NOTE-D ');
      await page.reload(); // panel still open, debounce still pending: the pagehide flush must save it
      await page.locator('#chat-title', { hasText: 'Data E2E' }).waitFor();
      await sleep(300);
      check(entry, 'store after reload with the panel open has the last text', /CHAT-NOTE-D/.test(noteText((await store()).chatNotesById?.[chatId])), noteText((await store()).chatNotesById?.[chatId]));
      await openNotes();
      await waitFor(async () => /CHAT-NOTE-A.*CHAT-NOTE-B.*CHAT-NOTE-C.*CHAT-NOTE-D/.test(await editorText()), 'all four texts after reload');
      await page.locator('#global-note-tab').click();
      check(entry, 'global note after reload still has only its own text', /GLOBAL-NOTE-G/.test(await editorText()) && !/CHAT-NOTE/.test(await editorText()), await editorText());
      entry.screenshots.push(await shot('bug1-notes-after-reload'));
      await page.locator('#close-notes-panel').click();
    });

    // ---- BUG #7: composer files ---------------------------------------------------------------
    let firstMessageId;
    await scenario('bug7-composer-keeps-next-draft-file', async entry => {
      await attach('first.txt', 'FIRST-FILE-TOKEN');
      await page.locator('#composer-files .file-tile', { hasText: 'first.txt' }).waitFor();
      const before = requests.length;
      await sendFromComposer('@Alpha [[c1]] read the file');
      await waitFor(() => held.length === 1, 'first request held');
      check(entry, 'provider received first.txt', requests[before].includes('FIRST-FILE-TOKEN'), requests[before].slice(-300));

      await attach('second.txt', 'SECOND-FILE-TOKEN'); // while the first send is still running
      await page.locator('#composer-files .file-tile', { hasText: 'second.txt' }).waitFor();
      check(entry, 'while the first send runs the composer holds only second.txt', JSON.stringify(await tiles()) === '["second.txt"]', await tiles());
      entry.screenshots.push(await shot('bug7-second-attached-while-first-runs'));

      release('Answer to the first file');
      await page.locator('.message.assistant', { hasText: 'Answer to the first file' }).waitFor();
      await sleep(500);
      check(entry, 'second.txt is still in the composer after the first send finished', JSON.stringify(await tiles()) === '["second.txt"]', await tiles());
      entry.screenshots.push(await shot('bug7-second-kept-after-first-finished'));

      const next = requests.length;
      await sendFromComposer('@Alpha [[c2]] read the next file');
      await waitFor(() => held.length === 1, 'second request held');
      // The chat replays earlier messages as text, never earlier file bytes.
      check(entry, 'provider received second.txt with the next message', requests[next].includes('SECOND-FILE-TOKEN') && !requests[next].includes('FIRST-FILE-TOKEN'), requests[next].slice(-300));
      release('Answer to the second file');
      await page.locator('.message.assistant', { hasText: 'Answer to the second file' }).waitFor();
      check(entry, 'composer is empty after the second send', (await tiles()).length === 0, await tiles());

      const users = (await chatMessages()).filter(m => m.type === 'user' && m.files?.length);
      check(entry, 'store: each message keeps exactly its own file', JSON.stringify(users.map(m => m.files.map(f => f.name))) === '[["first.txt"],["second.txt"]]', users.map(m => m.files));
      firstMessageId = users[0].id;
      const ids = await storedFileIds();
      check(entry, 'IndexedDB still holds both sent files', users.every(m => m.files.every(f => ids.includes(f.id))), ids);

      await page.reload();
      await page.locator('#chat-title', { hasText: 'Data E2E' }).waitFor();
      await page.locator('.message-files .file-tile').nth(1).waitFor();
      check(entry, 'after reload the composer is empty and both messages show their file', (await tiles()).length === 0 && await page.locator('.message-files .file-tile').count() === 2, await page.locator('.message-files .file-tile').count());
      entry.screenshots.push(await shot('bug7-after-reload'));
    });

    // ---- BUG #6: retry ------------------------------------------------------------------------
    const retryButton = text => page.locator('.message.assistant', { hasText: text }).locator('.message-tool-btn[aria-label="Retry reply"], .message-tool-btn[aria-label="Thử trả lời lại"]');
    await scenario('bug6-retry-keeps-files', async entry => {
      const before = requests.length;
      await retryButton('Answer to the second file').click();
      await waitFor(() => held.length === 1, 'retry request held');
      check(entry, 'the retried prompt carries second.txt again', requests[before].includes('SECOND-FILE-TOKEN'), requests[before].slice(-300));
      release('Retried answer with the file');
      await page.locator('.message.assistant', { hasText: 'Retried answer with the file' }).waitFor();
      entry.screenshots.push(await shot('bug6-retry-with-file'));
    });

    await scenario('bug6-retry-with-missing-file', async entry => {
      const users = (await chatMessages()).filter(m => m.type === 'user' && m.files?.length);
      const second = users.find(m => m.files[0].name === 'second.txt');
      await deleteStoredFile(second.files[0].id); // the file is gone from this (throwaway) profile's IndexedDB
      const before = requests.length;
      const messagesBefore = (await chatMessages()).map(m => m.id);
      await retryButton('Retried answer with the file').click();
      await page.locator('#error:not([hidden])', { hasText: 'second.txt' }).waitFor({ timeout: 5000 });
      const errorText = await page.locator('#error').textContent();
      entry.screenshots.push(await shot('bug6-missing-file-error'));
      await sleep(800);
      check(entry, 'the error names the missing file', /second\.txt/.test(errorText), errorText);
      check(entry, 'no prompt was sent without the file', requests.length === before && held.length === 0, requests.length - before);
      const s = await store();
      check(entry, 'the earlier answer is kept and the member is not left thinking', JSON.stringify((await chatMessages()).map(m => m.id)) === JSON.stringify(messagesBefore) && s.rolesById[alpha.id].status === 'ready', s.rolesById[alpha.id].status);
      check(entry, 'the first message can still be found with its file', Boolean(s.messagesById[firstMessageId]?.files?.length), firstMessageId);
    });
  } finally {
    await context.tracing.stop({ path: path.join(out, 'trace.zip') }).catch(() => {});
    await context.close().catch(() => {});
    server.close();
  }
  const summary = { kind: 'FIXTURE (fake OpenAI-compatible server, not a real provider)', at: new Date().toISOString(), results, pageErrors };
  writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(out, 'summary.md'), [`# Data integrity browser check (${summary.kind})`, '', ...results.map(r => `- **${r.status}** ${r.name}${r.error ? `\n  - ${r.error.split('\n')[0]}` : ''}\n${r.checks.map(c => `  - ${c.ok ? 'ok' : 'FAILED'}: ${c.label}`).join('\n')}`)].join('\n'));
  for (const r of results) console.log(`${r.status} ${r.name}${r.error ? ` — ${r.error.split('\n')[0]}` : ''}`);
  if (pageErrors.length) console.log('page errors:', pageErrors);
  process.exit(results.length > 0 && results.every(r => r.status === 'PASS') ? 0 : 1);
}

main().catch(error => { console.error(error); process.exit(1); });
