const { readFile, mkdir } = require('node:fs/promises');
const { readFileSync, existsSync: fsExists } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { importSource } = require('./test-support/source.cjs');


async function buildSeed(options = {}) {
  const api = await importSource('test-support/shared.ts');
  const seed = api.createDefaultStore();
  const now = new Date('2026-11-11T03:00:00Z').getTime();
  seed.settings.language = options.language ?? 'en';
  seed.currentChatId = 'chat';
  seed.chatOrder = ['chat'];
  seed.chatsById.chat = {
    id: 'chat', name: 'Product launch', mode: 'collaborative', status: 'ready',
    roleIds: ['product', 'engineer', 'growth'], messageIds: ['question', 'answer1', 'answer2'],
    nextMessageSeq: 4, createdAt: now, updatedAt: now, requireManualMention: true,
  };
  for (const [index, name, site] of [
    ['product', 'ProductManager', 'gemini'],
    ['engineer', 'Engineer', 'chatgpt'],
    ['growth', 'GrowthAdvisor', 'deepseek'],
  ]) {
    seed.roleTemplatesById[index] = {
      id: index, name, type: 'custom', description: 'Helps the team make practical decisions.',
      systemPrompt: 'Trả lời bằng tiếng Việt, rõ ràng và súc tích.', defaultChatSite: site,
    };
    seed.roleTemplateOrder.push(index);
    seed.rolesById[index] = {
      id: index, name, templateId: index, chatId: 'chat', chatSite: site, status: 'ready',
      description: seed.roleTemplatesById[index].description, modelSource: 'site',
      systemPrompt: seed.roleTemplatesById[index].systemPrompt, contextCursor: 1,
      updatedAt: now, geminiConversationUrl: 'https://' + (site === 'gemini' ? 'gemini.google.com/app/test' : site === 'chatgpt' ? 'chatgpt.com/c/test' : 'chat.deepseek.com/a/chat/s/test'),
    };
  }
  seed.messagesById.question = {
    id: 'question', chatId: 'chat', type: 'user', seq: 1, createdAt: now,
    content: 'Giúp tôi xác định ưu tiên cho đợt ra mắt sản phẩm tuần tới.',
    targetRoleIds: ['product', 'engineer', 'growth'], mentionsAll: true, status: 'received',
  };
  seed.messagesById.answer1 = {
    id: 'answer1', chatId: 'chat', type: 'assistant', seq: 2, createdAt: now + 1000,
    roleId: 'product', roleName: 'ProductManager', status: 'received', contentFormat: 'markdown',
    content: '**Chốt một mục tiêu chung trước khi chọn công việc.**\n\nTuần này, hãy tập trung vào luồng đăng ký và trải nghiệm đầu tiên. Mỗi việc trong kế hoạch cần đóng góp trực tiếp vào mục tiêu đó.\n\n- Xác định điều kiện hoàn thành.\n- Giữ khoảng trống cho lỗi phát sinh.\n- Hoãn các tính năng chưa cần cho lần ra mắt.',
  };
  seed.messagesById.answer2 = {
    id: 'answer2', chatId: 'chat', type: 'assistant', seq: 3, createdAt: now + 2000,
    roleId: 'engineer', roleName: 'Engineer', status: 'received', contentFormat: 'markdown',
    content: 'Tôi đề xuất kiểm thử toàn bộ luồng **đăng ký → tạo dự án → mời thành viên** trước. Đây là đường đi chính mà người dùng cần hoàn thành trong ngày đầu tiên.',
  };
  seed.settings.language = options.language || 'en';
  if (options.prepare) options.prepare(seed);
  return seed;
}

// Self-contained so it can run via addInitScript or be stringified into a <script> (preview-server.cjs).
function installFakeChrome({ seed }) {
    window.__fixtureCommands = [];
    const listeners = new Set();
    window.__fixturePush = message => listeners.forEach(listener => listener(message, {}, () => {}));
    window.chrome = {
      runtime: {
        onMessage: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) },
        getURL: value => location.origin + '/' + value,
        sendMessage(message, callback) {
          window.__fixtureCommands.push(message);
          if (message.type === 'ROLE_TEMPLATE_UPDATE') {
            Object.assign(seed.roleTemplatesById[message.templateId], message.patch);
          }
          if (message.type === 'GROUP_CHAT_UPDATE') {
            Object.assign(seed.chatsById[message.chatId], message.patch || message);
          }
          if (message.type === 'GROUP_CHAT_SWITCH') seed.currentChatId = message.chatId;
          if (message.type === 'GROUP_SETTINGS_UPDATE' && message.language) {
            seed.settings.language = message.language;
          }
          const result = { ok: true, store: seed, roles: Object.values(seed.rolesById), bindings: [], controlStatus: { state: 'disabled', port: 19305 } };
          if (callback) { queueMicrotask(() => callback(result)); return; }
          return Promise.resolve(result);
        },
      },
      tabs: { getCurrent: async () => ({ id: 77 }), create: async () => ({ id: 78 }) },
      storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
    };
    localStorage.setItem('themis:theme', 'light');
}

async function openFixture(options = {}) {
  const seed = await buildSeed(options);
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: options.viewport || { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const root = options.root || path.join(__dirname, 'dist');
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'themis.test') return route.fulfill({ body: '<!doctype html><title>Provider fixture</title>', contentType: 'text/html' });
    const relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'team.html';
    let filename = path.resolve(root, relative);
    if (root !== __dirname && !fsExists(filename)) filename = path.resolve(__dirname, relative);
    if (!filename.startsWith(__dirname + path.sep)) return route.abort();
    try {
      const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp' }[path.extname(filename)] || 'application/octet-stream';
      await route.fulfill({ body: await readFile(filename), contentType: type });
    } catch { await route.fulfill({ status: 404, body: 'Missing fixture resource' }); }
  });
  await page.addInitScript(installFakeChrome, { seed });
  await page.goto('https://themis.test/team.html');
  await page.locator('#chat-title').filter({ hasText: options.title || 'Product launch' }).waitFor();
  return { browser, page, seed, errors };
}

module.exports = { openFixture, buildSeed, installFakeChrome };
