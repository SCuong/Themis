const assert = require('node:assert/strict');
const { test } = require('node:test');
const { importSource } = require('./test-support/source.cjs');

test('frame assignment starts on mount, retries before load, and stops on readiness', async () => {
  const { IframeHost } = await importSource('test-support/team.ts');
  const timers = new Map();
  const posts = [];
  const clock = {
    setInterval(callback) { const key = Symbol(); timers.set(key, callback); return key; },
    clearInterval(key) { timers.delete(key); },
  };
  const host = new IframeHost({
    visibleHost: { dataset: {}, ownerDocument: {} },
    window: clock,
  });
  const group = { append(shell) { shell.parentElement = this; } };
  const frame = {
    chatId: 'chat', roleId: 'gemini', status: 'loading', assignmentAttempts: 0,
    src: 'https://gemini.google.com/app', shell: {},
    iframe: { contentWindow: { postMessage(message, origin) { posts.push({ message, origin }); } } },
  };
  host.framesByRoleKey.set('chat:gemini', frame);
  host.mountRole(frame, group);
  assert.equal(posts.length, 1, 'assignment must not wait for the iframe load event');
  assert.equal(posts[0].origin, 'https://gemini.google.com');
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(posts.length, 2);
  host.markRoleReady('chat', 'gemini');
  assert.equal(timers.size, 0);
  host.startAssignLoop(frame);
  assert.equal(posts.length, 2, 'a later load event must not restart an assigned frame');
  host.mountRole(frame, group);
  assert.equal(timers.size, 0);
});
