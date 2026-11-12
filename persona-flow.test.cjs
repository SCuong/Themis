const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const shared = import(require('node:url').pathToFileURL(require.resolve('./assets/imageAttachmentRepository-DBrzc-g8.js')).href);

function makeStore() {
  return {
    settings: { language: 'en', defaultChatSite: 'gemini' },
    roleTemplateOrder: [], roleTemplatesById: {}, rolesById: {},
    chatsById: { chat: { id: 'chat', roleIds: [], updatedAt: 0 } },
  };
}

test('saved custom personas survive English UI localization and role creation', async () => {
  const api = await shared;
  for (const id of ['default-custom-product-manager', 'default-custom-engineer', 'default-custom-growth']) {
    const store = makeStore();
    const template = api.i(store, {
      name: 'VietnameseAdvisor', description: 'Mô tả do người dùng lưu',
      systemPrompt: 'Luôn trả lời bằng tiếng Việt.', defaultChatSite: 'chatgpt',
    }, id, 1);
    assert.equal(api.Q(template, 'en').systemPrompt, template.systemPrompt);
    const role = api.a(store, { chatId: 'chat', templateId: id }, 'role', 2);
    assert.equal(role.systemPrompt, template.systemPrompt);
    assert.equal(role.description, template.description);
    assert.equal(role.name, template.name);
  }
});

test('saving a template updates linked ordinary roles and preserves unrelated state', async () => {
  const api = await shared;
  const store = makeStore();
  api.i(store, { name: 'Advisor', systemPrompt: 'Old persona' }, 'custom', 1);
  const role = api.a(store, { chatId: 'chat', templateId: 'custom' }, 'role', 2);
  role.geminiConversationUrl = 'https://gemini.google.com/app/test';
  store.rolesById.unrelated = { id: 'unrelated', templateId: 'other', systemPrompt: 'Keep me' };
  store.rolesById.generated = { id: 'generated', templateId: 'custom', createdBy: 'orchestration-auto', systemPrompt: 'Task-specific' };
  api.j(store, 'custom', { name: 'Advisor', systemPrompt: 'Trả lời bằng tiếng Việt.' }, 3);
  assert.equal(role.systemPrompt, 'Trả lời bằng tiếng Việt.');
  assert.equal(role.geminiConversationUrl, 'https://gemini.google.com/app/test');
  assert.equal(role.chatSite, 'gemini');
  assert.equal(store.rolesById.unrelated.systemPrompt, 'Keep me');
  assert.equal(store.rolesById.generated.systemPrompt, 'Task-specific');
});

test('storage round-trip repairs old persona copies without changing messages', async () => {
  const api = await shared;
  const store = api.C();
  store.settings.language = 'zh-CN';
  store.chatsById.chat = { id: 'chat', name: 'Test', roleIds: [], messageIds: ['message'], nextMessageSeq: 2 };
  store.chatOrder = ['chat'];
  const originalMessage = 'Keep this text: Giữ nguyên văn bản';
  store.messagesById.message = { id: 'message', chatId: 'chat', seq: 1, type: 'user', content: originalMessage };
  api.i(store, { name: 'Advisor', systemPrompt: 'Trả lời bằng tiếng Việt.' }, 'custom', 1);
  const role = api.a(store, { chatId: 'chat', templateId: 'custom' }, 'role', 2);
  role.systemPrompt = 'Stale English persona';
  const memory = {};
  global.chrome = { storage: { local: {
    async get(keys) {
      if (keys === null) return structuredClone(memory);
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(memory[key])]));
    },
    async set(values) { Object.assign(memory, structuredClone(values)); },
    async remove(keys) { for (const key of keys) delete memory[key]; },
  } } };
  try {
    await api.F(store);
    const loaded = await api.l();
    assert.equal(loaded.settings.language, 'vi');
    assert.equal(loaded.rolesById.role.systemPrompt, 'Trả lời bằng tiếng Việt.');
    assert.equal(loaded.messagesById.message.content, originalMessage);
    assert.deepEqual(loaded.chatsById.chat.messageIds, ['message']);
  } finally {
    delete global.chrome;
  }
});
