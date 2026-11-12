// Opt-in deletion of members' conversations on the AI sites when a chat is deleted.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test, after } = require('node:test');
const { JSDOM } = require('jsdom');
const { startThemis } = require('./prompt-sync-harness.cjs');
const { sourceScript } = require('./test-support/source.cjs');

const contentScript = sourceScript('test-support/content.ts', 'themisContent');

after(() => setImmediate(() => process.exit(0))); // background.js keeps keepalive timers alive

const members = () => [
  { id: 'gpt', name: 'Engineer', chatSite: 'chatgpt', conversationId: 'gpt-conversation-1' },
  { id: 'cla', name: 'Writer', chatSite: 'claude', conversationId: '0b1c2d3e-aaaa-bbbb-cccc-123456789abc' },
  { id: 'dsk', name: 'Critic', chatSite: 'deepseek', conversationId: 'dsk-session-77' },
  { id: 'gem', name: 'Planner', chatSite: 'gemini', conversationId: 'gem-conv-5' },
  { id: 'grk', name: 'Scout', chatSite: 'grok', conversationId: 'grok-conv-8' },
  { id: 'new', name: 'Fresh', chatSite: 'chatgpt' },
];

test('without opt-in, deleting a chat sends nothing to the AI sites', async () => {
  const team = await startThemis({ roles: members() });
  const response = await team.send({ type: 'GROUP_CHAT_DELETE', chatId: 'chat' });
  assert.equal(response.ok, true);
  assert.equal(response.remoteDeletes, undefined);
  assert.deepEqual(team.frameMessages.filter(m => m.type === 'TEAM_DELETE_CONVERSATION'), []);
});

test('with opt-in, each supported member with a conversation gets one delete, and failures are reported', async () => {
  const team = await startThemis({ roles: members() });
  team.frameResponders.TEAM_DELETE_CONVERSATION = message => (message.roleId === 'cla' ? { ok: false, error: 'http-403' } : { ok: true });
  const response = await team.send({ type: 'GROUP_CHAT_DELETE', chatId: 'chat', deleteRemote: true });
  assert.equal(response.ok, true);
  const deletes = team.frameMessages.filter(m => m.type === 'TEAM_DELETE_CONVERSATION');
  // A member without a conversation has nothing to delete.
  assert.deepEqual(deletes.map(m => [m.roleId, m.conversationId]), [
    ['gpt', 'gpt-conversation-1'],
    ['cla', '0b1c2d3e-aaaa-bbbb-cccc-123456789abc'],
    ['dsk', 'dsk-session-77'],
    ['gem', 'gem-conv-5'],
    ['grk', 'grok-conv-8'],
  ]);
  assert.deepEqual(response.remoteDeletes.map(r => [r.site, r.ok, r.error]), [
    ['chatgpt', true, undefined],
    ['claude', false, 'http-403'],
    ['deepseek', true, undefined],
    ['gemini', true, undefined],
    ['grok', true, undefined],
  ]);
  assert.equal((await team.store()).chatsById.chat, undefined, 'the chat is still deleted locally');
});

// Runs the content-script delete in a page of the given site with a recording fetch.
async function deleteOnSite(host, siteId, conversationId, { cookie = '', storage = {}, html = '<!doctype html>', responses }) {
  const dom = new JSDOM(html, { url: `https://${host}/`, runScripts: 'outside-only' });
  const calls = [];
  dom.window.document.cookie = cookie;
  for (const [key, value] of Object.entries(storage)) dom.window.localStorage.setItem(key, value);
  dom.window.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const body = responses[url.replace(`https://${host}`, '').split('?')[0]] ?? {};
    return { ok: body.status === undefined || body.status < 400, status: body.status ?? 200, json: async () => body.json ?? {}, text: async () => body.text ?? '' };
  };
  dom.window.eval(`${contentScript};window.run=id=>themisContent.deleteConversation(id,${JSON.stringify(siteId)},{info(){}});`);
  try { return { result: await dom.window.run(conversationId), calls }; } finally { dom.window.close(); }
}

test('ChatGPT hides the conversation the way its own delete button does', async () => {
  const { result, calls } = await deleteOnSite('chatgpt.com', 'chatgpt', 'abc-123456', { responses: { '/api/auth/session': { json: { accessToken: 'tok' } } } });
  assert.equal(result.ok, true);
  assert.equal(calls[1].url, 'https://chatgpt.com/backend-api/conversation/abc-123456');
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].headers.authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[1].body), { is_visible: false });
});

test('Claude deletes in the last active organization', async () => {
  const { calls } = await deleteOnSite('claude.ai', 'claude', '0b1c2d3e-aaaa', { cookie: 'lastActiveOrg=org-9', responses: {} });
  assert.deepEqual(calls.map(c => [c.method, c.url]), [['DELETE', 'https://claude.ai/api/organizations/org-9/chat_conversations/0b1c2d3e-aaaa']]);
});

test('DeepSeek deletes the chat session and checks its result code', async () => {
  const ok = await deleteOnSite('chat.deepseek.com', 'deepseek', 'dsk-session-77', {
    storage: { userToken: JSON.stringify({ value: 'dtok' }) },
    responses: { '/api/v0/chat_session/delete': { json: { code: 0 } } },
  });
  assert.deepEqual(JSON.parse(ok.calls[0].body), { chat_session_id: 'dsk-session-77' });
  assert.equal(ok.calls[0].headers.authorization, 'Bearer dtok');
  await assert.rejects(deleteOnSite('chat.deepseek.com', 'deepseek', 'dsk-session-77', {
    storage: { userToken: JSON.stringify({ value: 'dtok' }) },
    responses: { '/api/v0/chat_session/delete': { json: { code: 40003 } } },
  }), /deepseek-code-40003/);
});

test('a malformed conversation id never reaches a request URL', async () => {
  await assert.rejects(deleteOnSite('chatgpt.com', 'chatgpt', '../../account/delete', { responses: {} }), /invalid-conversation-id/);
});

test('deleting a chat asks a second, opt-in question listing the members and their sites', { timeout: 60000 }, async () => {
  const { openFixture } = require('./ui-fixture.cjs');
  const { browser, page, errors } = await openFixture({ prepare: seed => { for (const role of Object.values(seed.rolesById)) role.geminiConversationId = `conv-${role.id}`; } });
  try {
    const dialogs = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.accept(); });
    await page.locator('.chat-menu-btn').first().click();
    await page.getByRole('button', { name: 'Delete chat' }).click();
    await page.waitForFunction(() => window.__fixtureCommands.some(command => command.type === 'GROUP_CHAT_DELETE'));
    const command = (await page.evaluate(() => window.__fixtureCommands)).find(c => c.type === 'GROUP_CHAT_DELETE');
    assert.equal(command.deleteRemote, true);
    assert.equal(dialogs.length, 2);
    assert.match(dialogs[1], /Also delete these conversations on the AI sites\?/);
    assert.match(dialogs[1], /\(ChatGPT\)/);
    assert.match(dialogs[1], /((ChatGPT|Gemini|DeepSeek))/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Gemini deletes through batchexecute with the page token and the c_ conversation id', async () => {
  const html = '<!doctype html><html lang="vi"><script>window.WIZ_global_data={"SNlM0e":"at-token","cfb2h":"boq_bl","FdrFJe":"-123"};</script></html>';
  const { calls } = await deleteOnSite('gemini.google.com', 'gemini', 'abc123def456', { html, responses: { '/_/BardChatUi/data/batchexecute': { text: ")]}'\n[[\"wrb.fr\",\"GzXR5e\",\"[]\"]]" } } });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/_/BardChatUi/data/batchexecute');
  assert.equal(url.searchParams.get('rpcids'), 'GzXR5e');
  assert.equal(url.searchParams.get('bl'), 'boq_bl');
  assert.equal(url.searchParams.get('f.sid'), '-123');
  assert.equal(calls[0].body.get('at'), 'at-token');
  assert.deepEqual(JSON.parse(calls[0].body.get('f.req')), [[['GzXR5e', '["c_abc123def456"]', null, 'generic']]]);
});

test('Gemini reports an unexpected answer instead of claiming success', async () => {
  const html = '<script>window.WIZ_global_data={"SNlM0e":"at-token"};</script>';
  await assert.rejects(deleteOnSite('gemini.google.com', 'gemini', 'abc123def456', { html, responses: { '/_/BardChatUi/data/batchexecute': { text: ")]}'\n[[\"wrb.fr\",\"GzXR5e\",null,null,null,[3],\"generic\"]]" } } }), /gemini-unexpected-response/);
});

test('Grok deletes the conversation by id', async () => {
  const { calls } = await deleteOnSite('grok.com', 'grok', 'b2c3d4e5-1111', { responses: {} });
  assert.deepEqual(calls.map(c => [c.method, c.url]), [['DELETE', 'https://grok.com/rest/app-chat/conversations/b2c3d4e5-1111']]);
});
