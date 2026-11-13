// Loads the real background.js service worker against a fake `chrome`, so tests
// drive the same onMessage router the extension uses and read the exact prompt
// text handed to chrome.tabs.sendMessage.
const { pathToFileURL } = require('node:url');
const { importSource, dist } = require('./test-support/source.cjs');
require('fake-indexeddb/auto'); // spec-accurate IndexedDB for the image and file stores

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

// Pass the memory of an earlier instance to restart the service worker on the same chrome.storage.
async function startThemis({ mode = 'collaborative', language = 'vi', roles, seed, memory: restart }) {
  const memory = restart ?? {};
  const prompts = [];
  // Every other message sent to a member frame, and an optional per-type responder for it.
  const frameMessages = [];
  const frameResponders = {};
  let listener;
  let failNextSend = 0;
  const event = { addListener() {} };
  // Browser tabs and DNR session rules, for the per-tab frame rules.
  const tabs = [];
  let sessionRules = [];
  const tabListeners = {};
  const tabEvent = name => ({ addListener(fn) { (tabListeners[name] ??= []).push(fn); } });
  // A small cookie jar for chrome.cookies: unpartitioned cookies, plus partitioned ones (partitionKey).
  const cookieJar = [];
  const cookieListeners = [];
  const samePartition = (cookie, key) => (cookie.partitionKey?.topLevelSite ?? null) === (key?.topLevelSite ?? null);
  const sameCookie = (a, b) => a.name === b.name && (a.path ?? '/') === (b.path ?? '/') && samePartition(a, b.partitionKey);
  global.chrome = {
    storage: { local: {
      async get(keys) {
        if (keys === null || keys === undefined) return structuredClone(memory);
        return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in memory).map(key => [key, structuredClone(memory[key])]));
      },
      async set(values) { Object.assign(memory, structuredClone(values)); },
      async remove(keys) { for (const key of [].concat(keys)) delete memory[key]; },
    }, session: (() => {
      const data = {};
      return {
        async get(keys) { return keys == null ? structuredClone(data) : Object.fromEntries([].concat(keys).filter(k => k in data).map(k => [k, structuredClone(data[k])])); },
        async set(values) { Object.assign(data, structuredClone(values)); },
      };
    })() },
    runtime: {
      id: 'test', getURL: path => `chrome-extension://test/${path}`, getManifest: () => ({ version: 'test' }),
      onInstalled: event, onStartup: event, sendMessage: async () => ({}),
      onMessage: { addListener(fn) { listener = fn; } },
    },
    declarativeNetRequest: {
      async updateSessionRules({ removeRuleIds = [], addRules = [] }) { sessionRules = [...sessionRules.filter(r => !removeRuleIds.includes(r.id)), ...structuredClone(addRules)]; },
      async getSessionRules() { return structuredClone(sessionRules); },
    },
    cookies: {
      async getAll({ domain, partitionKey }) {
        return structuredClone(cookieJar.filter(c => c.domain.replace(/^\./, '').endsWith(domain) && samePartition(c, partitionKey)));
      },
      async set({ url, domain, path = '/', partitionKey, ...rest }) {
        const cookie = { ...rest, path, domain: domain ?? new URL(url).hostname, hostOnly: !domain, ...(partitionKey ? { partitionKey } : {}) };
        const at = cookieJar.findIndex(c => sameCookie(c, cookie));
        if (at >= 0) cookieJar.splice(at, 1, cookie); else cookieJar.push(cookie);
        return cookie;
      },
      async remove({ url, name, partitionKey }) {
        const at = cookieJar.findIndex(c => sameCookie(c, { name, path: new URL(url).pathname, partitionKey }));
        if (at >= 0) cookieJar.splice(at, 1);
      },
      onChanged: { addListener(fn) { cookieListeners.push(fn); } },
    },
    action: { onClicked: event },
    alarms: { create() {}, onAlarm: event },
    tabs: {
      onRemoved: tabEvent('onRemoved'), onCreated: tabEvent('onCreated'), onUpdated: tabEvent('onUpdated'), onReplaced: tabEvent('onReplaced'),
      create: async () => ({}),
      async query() { return structuredClone(tabs); },
      async sendMessage(tabId, message, options) {
        if (message.type !== 'TEAM_SEND_PROMPT') { frameMessages.push({ ...message, frameId: options.frameId }); return frameResponders[message.type]?.(message) ?? { ok: true }; }
        if (failNextSend > 0) { failNextSend -= 1; throw new Error('Could not establish connection'); }
        prompts.push({ ...message, frameId: options.frameId });
        return { ok: true, messageId: message.messageId };
      },
    },
  };

  const shared = await importSource('test-support/shared.ts');
  const store = shared.createDefaultStore();
  store.settings.language = language;
  store.chatsById.chat = { id: 'chat', name: 'Test', mode, roleIds: [], messageIds: [], nextMessageSeq: 1, status: 'ready', createdAt: 1, updatedAt: 1 };
  store.chatOrder = ['chat'];
  roles.forEach((role, index) => {
    store.rolesById[role.id] = { chatId: 'chat', modelSource: 'site', chatSite: 'gemini', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1, ...role };
    store.chatsById.chat.roleIds.push(role.id);
    role.frameId = index + 1;
  });
  seed?.(store);
  if (!restart) await shared.saveStore(store);

  instance += 1;
  await import(`${pathToFileURL(dist('background.js')).href}?instance=${instance}`);

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
    memory,
    tabs,
    async fireTab(name, ...args) { for (const fn of tabListeners[name] ?? []) fn(...args); await new Promise(r => setTimeout(r, 20)); },
    cookieJar,
    async fireCookie(change) { for (const fn of cookieListeners) fn(change); await new Promise(r => setTimeout(r, 20)); },
    sessionRules: () => chrome.declarativeNetRequest.getSessionRules(),
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
  for (const role of roles) if (!role.notReady) await api.frameReady(role.id, role.conversationId);
  return api;
}

module.exports = { startThemis };
