// Deleting or clearing a chat removes everything that belongs to it, including attachments in IndexedDB.
// Attachment deletes go through a persistent cleanup queue: a failed delete stays queued and is retried
// when the service worker starts again.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { pathToFileURL } = require('node:url');
const { startThemis } = require('./prompt-sync-harness.cjs'); // also installs fake-indexeddb

after(() => setImmediate(() => process.exit(0))); // background.js keeps keepalive timers alive

const QUEUE = 'themis.cleanupQueue';
const images = async () => (await import(pathToFileURL(require.resolve('./assets/imageAttachmentRepository-DBrzc-g8.js')).href)).B();

function filesDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('themis.composerFiles', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function files(mode, fn) {
  const db = await filesDb();
  try {
    return await new Promise((resolve, reject) => {
      const q = fn(db.transaction('files', mode).objectStore('files'));
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  } finally { db.close(); }
}
const putFile = id => files('readwrite', s => s.put({ id, name: `${id}.txt`, blob: 'x' }));
const hasFile = async id => !!(await files('readonly', s => s.get(id)));

// An IndexedDB whose every open fails, like a corrupted or locked profile database.
const brokenIndexedDB = {
  open() {
    const request = new EventTarget();
    setTimeout(() => {
      Object.defineProperty(request, 'error', { value: new Error('IndexedDB is broken') });
      request.onerror?.();
      request.dispatchEvent(new Event('error'));
    });
    return request;
  },
};

let n = 0;
// Chat "chat" (member r1, message m1 with an image and two files) and chat "other" (message m3 sharing one file).
async function seeded(extra = {}) {
  const id = ++n;
  const ids = { image: `img-${id}`, own: `file-own-${id}`, shared: `file-shared-${id}` };
  const repo = await images();
  await repo.put({ id: ids.image, chatId: 'chat', messageId: 'm1', blob: 'png' });
  await repo.put({ id: `${ids.image}-other`, chatId: 'other', messageId: 'm3', blob: 'png' });
  await putFile(ids.own);
  await putFile(ids.shared);
  const team = await startThemis({
    roles: [{ id: 'r1', name: 'One' }],
    seed(store) {
      store.chatsById.other = { ...store.chatsById.chat, id: 'other', roleIds: [], messageIds: ['m3'] };
      store.chatOrder.push('other');
      // Images must be referenced by a message, or the worker's startup orphan sweep removes them.
      const msg = (mid, chatId, fileIds, imageId) => ({ id: mid, chatId, seq: 1, role: 'user', content: 'hi', createdAt: 1, attachments: [{ id: imageId, type: 'image', status: 'ready' }], files: fileIds.map(f => ({ id: f, name: `${f}.txt` })) });
      store.messagesById.m1 = msg('m1', 'chat', [ids.own, ids.shared], ids.image);
      store.messagesById.m3 = msg('m3', 'other', [ids.shared], `${ids.image}-other`);
      store.chatsById.chat.messageIds.push('m1');
      const mem = owner => ({ ...owner, summary: 's', summarizedThroughSeq: 1, updatedAt: 1 });
      const hl = (hid, messageId) => ({ id: hid, messageId, text: 'hi', startOffset: 0, endOffset: 2, createdAt: 1 });
      Object.assign(store, {
        chatNotesById: { chat: { type: 'doc' }, other: { type: 'doc' } },
        messageHighlightsById: { m1: [hl('h1', 'm1')], m3: [hl('h3', 'm3')] },
        externalChatMemoriesById: { chat: mem({ chatId: 'chat' }), other: mem({ chatId: 'other' }) },
        externalRoleMemoriesById: { r1: mem({ roleId: 'r1' }), rX: mem({ roleId: 'rX' }) },
        orchestrationFlowsById: { fl1: { id: 'fl1', chatId: 'chat', name: 'A' }, fl2: { id: 'fl2', chatId: 'other', name: 'B' } },
        orchestrationFlowOrderByChatId: { chat: ['fl1'], other: ['fl2'] },
        orchestrationRunsById: { run1: { id: 'run1', chatId: 'chat', flowId: 'fl1' }, run2: { id: 'run2', chatId: 'other', flowId: 'fl2' } },
        activeOrchestrationRunIdByChatId: { chat: 'run1', other: 'run2' },
      });
      extra.seed?.(store);
    },
  });
  return { team, ids, repo };
}
const queue = team => team.memory[QUEUE] ?? [];
async function until(check, what) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); }
  assert.fail(`timed out waiting for ${what}`);
}

test('normal delete: no data of the chat is left and the cleanup completes', async () => {
  const { team } = await seeded();
  const response = await team.send({ type: 'GROUP_CHAT_DELETE', chatId: 'chat' });
  assert.equal(response.ok, true);
  assert.equal(response.cleanup, 'done');
  const s = await team.store();
  const keys = obj => Object.keys(obj ?? {});
  assert.equal(s.chatsById.chat, undefined);
  assert.equal(s.messagesById.m1, undefined);
  assert.equal(s.rolesById.r1, undefined);
  assert.deepEqual(keys(s.chatNotesById), ['other']);
  assert.deepEqual(keys(s.messageHighlightsById), ['m3']);
  assert.deepEqual(keys(s.externalChatMemoriesById), ['other']);
  assert.deepEqual(keys(s.externalRoleMemoriesById), ['rX']);
  assert.deepEqual(keys(s.orchestrationFlowsById), ['fl2']);
  assert.deepEqual(keys(s.orchestrationFlowOrderByChatId), ['other']);
  assert.deepEqual(keys(s.orchestrationRunsById), ['run2']);
  assert.deepEqual(keys(s.activeOrchestrationRunIdByChatId), ['other']);
  assert.deepEqual(queue(team), []);
});

test('delete a chat with images: its images are removed, other chats keep theirs', async () => {
  const { team, ids, repo } = await seeded();
  await team.send({ type: 'GROUP_CHAT_DELETE', chatId: 'chat' });
  assert.equal(await repo.get(ids.image), undefined);
  assert.ok(await repo.get(`${ids.image}-other`));
});

test('delete a chat with files: its files are removed', async () => {
  const { team, ids } = await seeded();
  await team.send({ type: 'GROUP_CHAT_DELETE', chatId: 'chat' });
  assert.equal(await hasFile(ids.own), false);
});

test('a file shared with another chat is kept while still referenced', async () => {
  const { team, ids } = await seeded();
  await team.send({ type: 'GROUP_CHAT_DELETE', chatId: 'chat' });
  assert.equal(await hasFile(ids.shared), true);
});

test('broken IndexedDB: the delete reports cleanup pending and keeps the task; a restart finishes it', async () => {
  const { team, ids, repo } = await seeded();
  const working = globalThis.indexedDB;
  globalThis.indexedDB = brokenIndexedDB;
  let broken;
  try {
    // A fresh worker instance, so its image store has not opened the real database yet.
    broken = await startThemis({ roles: [], memory: team.memory });
    const response = await broken.send({ type: 'GROUP_CHAT_DELETE', chatId: 'chat' });
    assert.equal(response.ok, true, 'the chat itself is deleted');
    assert.equal(response.cleanup, 'pending');
    const [task] = queue(broken);
    assert.equal(task.kind, 'chat');
    assert.equal(task.chatId, 'chat');
    assert.equal(task.attempts, 1);
    assert.match(task.lastError, /broken|unavailable|open/i);
    assert.ok(await working.databases(), 'sanity: real IndexedDB still works');
  } finally { globalThis.indexedDB = working; }
  assert.ok(await repo.get(ids.image), 'image not deleted yet');

  // Extension restart: the worker starts on the same storage and retries the queue by itself.
  const restarted = await startThemis({ roles: [], memory: broken.memory });
  await until(() => queue(restarted).length === 0, 'the queued cleanup to finish');
  assert.equal(await repo.get(ids.image), undefined);
  assert.equal(await hasFile(ids.own), false);
  assert.equal(await hasFile(ids.shared), true);
});

test('running the same cleanup task again is harmless', async () => {
  const { team } = await seeded();
  await team.send({ type: 'GROUP_CHAT_DELETE', chatId: 'chat' });
  // Replay a finished task twice, as a lost acknowledgement or duplicated queue write would.
  const task = { id: 'cleanup-replay', kind: 'chat', chatId: 'chat', fileIds: ['file-gone'], attempts: 0, createdAt: 1 };
  team.memory[QUEUE] = [task, { ...task }];
  const restarted = await startThemis({ roles: [], memory: team.memory });
  await until(() => queue(restarted).length === 0, 'the replayed tasks to clear');
  assert.equal((await restarted.send({ type: 'GROUP_STORE_GET' })).ok, true);
});

test('clearing messages drops their highlights, files, images and model memories, keeps notes and workflows', async () => {
  const { team, ids, repo } = await seeded();
  const response = await team.send({ type: 'GROUP_CHAT_CLEAR_MESSAGES', chatId: 'chat' });
  assert.equal(response.ok, true);
  assert.equal(response.cleanup, 'done');
  const s = await team.store();
  assert.deepEqual(Object.keys(s.messageHighlightsById), ['m3']);
  assert.deepEqual(Object.keys(s.externalChatMemoriesById), ['other']);
  assert.deepEqual(Object.keys(s.externalRoleMemoriesById), ['rX']);
  assert.ok(s.chatNotesById.chat);
  assert.ok(s.orchestrationFlowsById.fl1);
  assert.equal(await repo.get(ids.image), undefined);
  assert.equal(await hasFile(ids.own), false);
  assert.equal(await hasFile(ids.shared), true);
  assert.deepEqual(queue(team), []);
});
