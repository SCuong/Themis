// Deleting a chat removes every piece of data that belongs to it, and nothing else.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { startThemis } = require('./prompt-sync-harness.cjs');

after(() => setImmediate(() => process.exit(0))); // background.js keeps keepalive timers alive

// Just enough IndexedDB for otDeleteComposerFiles: records the deleted ids.
const deletedFiles = [];
global.indexedDB = {
  open(name) {
    const request = {};
    if (name !== "themis.composerFiles") { setTimeout(() => request.onerror?.()); return request; } // other stores: unavailable
    const db = {
      close() {},
      transaction() {
        const tx = { objectStore: () => ({ delete: id => deletedFiles.push(id) }) };
        setTimeout(() => tx.oncomplete?.());
        return tx;
      },
    };
    setTimeout(() => { request.result = db; request.onsuccess?.(); });
    return request;
  },
};

test('chat delete cascades to notes, highlights, memories, workflows, runs and stored files', async () => {
  const team = await startThemis({
    roles: [{ id: 'r1', name: 'One' }],
    seed(store) {
      store.chatsById.other = { ...store.chatsById.chat, id: 'other', roleIds: [], messageIds: ['m3'] };
      store.chatOrder.push('other');
      const msg = (id, chatId, files) => ({ id, chatId, seq: 1, role: 'user', content: 'hi', createdAt: 1, files });
      store.messagesById.m1 = msg('m1', 'chat', [{ id: 'f-own', name: 'a.txt' }, { id: 'f-shared', name: 'b.txt' }]);
      store.messagesById.m3 = msg('m3', 'other', [{ id: 'f-shared', name: 'b.txt' }]);
      store.chatsById.chat.messageIds.push('m1');
      const hl = (id, messageId) => ({ id, messageId, text: 'hi', startOffset: 0, endOffset: 2, createdAt: 1 });
      const mem = owner => ({ ...owner, summary: 's', summarizedThroughSeq: 1, updatedAt: 1 });
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
    },
  });
  assert.equal((await team.send({ type: 'GROUP_CHAT_DELETE', chatId: 'chat' })).ok, true);
  const s = await team.store();
  const keys = obj => Object.keys(obj ?? {});
  assert.deepEqual(keys(s.chatNotesById), ['other']);
  assert.deepEqual(keys(s.messageHighlightsById), ['m3']);
  assert.deepEqual(keys(s.externalChatMemoriesById), ['other']);
  assert.deepEqual(keys(s.externalRoleMemoriesById), ['rX']);
  assert.deepEqual(keys(s.orchestrationFlowsById), ['fl2']);
  assert.deepEqual(keys(s.orchestrationFlowOrderByChatId), ['other']);
  assert.deepEqual(keys(s.orchestrationRunsById), ['run2']);
  assert.deepEqual(keys(s.activeOrchestrationRunIdByChatId), ['other']);
  // A file another chat's message still shows is kept.
  assert.deepEqual(deletedFiles, ['f-own']);
});

test('clearing messages drops their highlights, files and model memories but keeps notes and workflows', async () => {
  deletedFiles.length = 0;
  const team = await startThemis({
    roles: [{ id: 'r1', name: 'One' }],
    seed(store) {
      store.messagesById.m1 = { id: 'm1', chatId: 'chat', seq: 1, role: 'user', content: 'hi', createdAt: 1, files: [{ id: 'f1', name: 'a.txt' }] };
      store.chatsById.chat.messageIds.push('m1');
      const mem = owner => ({ ...owner, summary: 's', summarizedThroughSeq: 1, updatedAt: 1 });
      Object.assign(store, {
        chatNotesById: { chat: { type: 'doc' } },
        messageHighlightsById: { m1: [{ id: 'h1', messageId: 'm1', text: 'hi', startOffset: 0, endOffset: 2, createdAt: 1 }] },
        externalChatMemoriesById: { chat: mem({ chatId: 'chat' }) },
        externalRoleMemoriesById: { r1: mem({ roleId: 'r1' }) },
        orchestrationFlowsById: { fl1: { id: 'fl1', chatId: 'chat', name: 'A' } },
        orchestrationFlowOrderByChatId: { chat: ['fl1'] },
      });
    },
  });
  assert.equal((await team.send({ type: 'GROUP_CHAT_CLEAR_MESSAGES', chatId: 'chat' })).ok, true);
  const s = await team.store();
  assert.deepEqual(s.messageHighlightsById, {});
  assert.deepEqual(s.externalChatMemoriesById, {});
  assert.deepEqual(s.externalRoleMemoriesById, {});
  assert.deepEqual(Object.keys(s.chatNotesById), ['chat']);
  assert.deepEqual(Object.keys(s.orchestrationFlowsById), ['fl1']);
  assert.deepEqual(deletedFiles, ['f1']);
});
