// Loads the real background.js service worker against a fake `chrome`, so tests
// drive the same onMessage router the extension uses and read the exact prompt
// text handed to chrome.tabs.sendMessage.
const { pathToFileURL } = require('node:url');

const SITE_URL = {
  gemini: id => `https://gemini.google.com/app/${id}`,
  chatgpt: id => `https://chatgpt.com/c/${id}`,
  claude: id => `https://claude.ai/chat/${id}`,
  deepseek: id => `https://chat.deepseek.com/a/chat/s/${id}`,
  grok: id => `https://grok.com/c/${id}`,
};
let instance = 0;
// The service worker logs every step; keep test output readable.
console.log = console.info = console.debug = console.warn = () => {};

async function startThemis({ mode = 'collaborative', language = 'vi', roles, seed }) {
  const memory = {};
  const prompts = [];
  // Every other message sent to a member frame, and an optional per-type responder for it.
  const frameMessages = [];
  const frameResponders = {};
  let listener;
  let failNextSend = 0;
  const event = { addListener() {} };
  global.chrome = {
    storage: { local: {
      async get(keys) {
        if (keys === null || keys === undefined) return structuredClone(memory);
        return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in memory).map(key => [key, structuredClone(memory[key])]));
      },
      async set(values) { Object.assign(memory, structuredClone(values)); },
      async remove(keys) { for (const key of [].concat(keys)) delete memory[key]; },
    } },
    runtime: {
      id: 'test', getURL: path => `chrome-extension://test/${path}`, getManifest: () => ({ version: 'test' }),
      onInstalled: event, onStartup: event, sendMessage: async () => ({}),
      onMessage: { addListener(fn) { listener = fn; } },
    },
    action: { onClicked: event },
    alarms: { create() {}, onAlarm: event },
    tabs: {
      onRemoved: event, create: async () => ({}),
      async sendMessage(tabId, message, options) {
        if (message.type !== 'TEAM_SEND_PROMPT') { frameMessages.push({ ...message, frameId: options.frameId }); return frameResponders[message.type]?.(message) ?? { ok: true }; }
        if (failNextSend > 0) { failNextSend -= 1; throw new Error('Could not establish connection'); }
        prompts.push({ ...message, frameId: options.frameId });
        return { ok: true, messageId: message.messageId };
      },
    },
  };

  const shared = await import(pathToFileURL(require.resolve('./assets/imageAttachmentRepository-DBrzc-g8.js')).href);
  const store = shared.C();
  store.settings.language = language;
  store.chatsById.chat = { id: 'chat', name: 'Test', mode, roleIds: [], messageIds: [], nextMessageSeq: 1, status: 'ready', createdAt: 1, updatedAt: 1 };
  store.chatOrder = ['chat'];
  roles.forEach((role, index) => {
    store.rolesById[role.id] = { chatId: 'chat', modelSource: 'site', chatSite: 'gemini', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1, ...role };
    store.chatsById.chat.roleIds.push(role.id);
    role.frameId = index + 1;
  });
  seed?.(store);
  await shared.F(store);

  instance += 1;
  await import(`${pathToFileURL(require.resolve('./background.js')).href}?instance=${instance}`);

  const frameOf = roleId => roles.find(role => role.id === roleId).frameId;
  const send = (message, roleId) => new Promise((resolve, reject) => {
    const sender = roleId ? { tab: { id: 1 }, frameId: frameOf(roleId), url: 'https://gemini.google.com/app' } : { tab: { id: 1 }, url: 'chrome-extension://test/team.html' };
    const timer = setTimeout(() => reject(new Error(`No response to ${message.type}`)), 20000);
    listener({ hostTabId: 1, ...message }, sender, response => { clearTimeout(timer); resolve(response); });
  });
  const conversation = (roleId, conversationId) => {
    if (!conversationId) return {};
    const site = (roles.find(role => role.id === roleId).chatSite) ?? 'gemini';
    return { conversationId, conversationUrl: SITE_URL[site](conversationId) };
  };
  const expectOk = (response, what) => {
    if (!response || response.ok === false) throw new Error(`${what} failed: ${response && response.error}`);
    return response;
  };

  const api = {
    prompts,
    frameMessages,
    frameResponders,
    send,
    failNextSend(count = 1) { failNextSend = count; },
    async store() { return (await send({ type: 'GROUP_STORE_GET' })).store; },
    async role(roleId) { return (await api.store()).rolesById[roleId]; },
    // The provider iframe (re)loaded; conversationId undefined means a blank new chat.
    async frameReady(roleId, conversationId) {
      return expectOk(await send({ type: 'TEAM_FRAME_ROLE_READY', chatId: 'chat', roleId, ...conversation(roleId, conversationId) }, roleId), 'frame ready');
    },
    async conversationUpdated(roleId, conversationId) {
      return expectOk(await send({ type: 'TEAM_ROLE_CONVERSATION_UPDATED', chatId: 'chat', roleId, ...conversation(roleId, conversationId) }, roleId), 'conversation update');
    },
    // Returns the prompts delivered for this user message, keyed by roleId.
    async user(raw, extra = {}) {
      const before = prompts.length;
      // Without a mention the default target is nobody unless the chat opted out of manual mentions.
      const response = expectOk(await send({ type: 'GROUP_MESSAGE_SEND', chatId: 'chat', raw: raw.includes('@') ? raw : `@all ${raw}`, ...extra }), 'send');
      return { messageId: response.message.id, byRole: Object.fromEntries(prompts.slice(before).map(prompt => [prompt.roleId, prompt])) };
    },
    async ack(roleId, messageId) {
      return expectOk(await send({ type: 'TEAM_SEND_ACK', chatId: 'chat', roleId, messageId }, roleId), 'ack');
    },
    async reply(roleId, prompt, content, conversationId) {
      return expectOk(await send({ type: 'TEAM_ROLE_REPLY', chatId: 'chat', roleId, messageId: prompt.messageId, replyAttemptId: prompt.replyAttemptId, content, ...conversation(roleId, conversationId) }, roleId), 'reply');
    },
    // One full successful turn for every role: prompt, ack, reply in conversation `c-<roleId>`.
    async turn(raw, replyText = roleId => `Reply from ${roleId}`) {
      const sent = await api.user(raw);
      for (const [roleId, prompt] of Object.entries(sent.byRole)) {
        await api.ack(roleId, sent.messageId);
        await api.reply(roleId, prompt, replyText(roleId), `c-${roleId}`);
      }
      return sent;
    },
    async retry(roleId, messageId) {
      const before = prompts.length;
      expectOk(await send({ type: 'GROUP_ROLE_RETRY_REPLY', chatId: 'chat', roleId, messageId }), 'retry');
      return prompts.slice(before).find(prompt => prompt.roleId === roleId);
    },
  };
  for (const role of roles) await api.frameReady(role.id, role.conversationId);
  return api;
}

module.exports = { startThemis };
