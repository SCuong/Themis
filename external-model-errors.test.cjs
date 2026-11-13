const assert = require('node:assert/strict');
const { test } = require('node:test');
const { startThemis } = require('./prompt-sync-harness.cjs');

// The AI SDK's textStream swallows provider errors; the client must surface them instead of "empty response".
test('external model errors reach the user instead of an empty-response message', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid API key provided', type: 'invalid_request_error' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  try {
    const themis = await startThemis({ roles: [{ id: 'a', name: 'A' }] });
    const created = await themis.send({ type: 'EXTERNAL_MODEL_CREATE', name: 'Go', format: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'test-key', modelName: 'demo' });
    const result = await themis.send({ type: 'EXTERNAL_MODEL_TEST', modelId: created.model.id });
    assert.equal(result.ok, false);
    assert.match(result.error, /Invalid API key|401/);
    assert.doesNotMatch(result.error, /empty content|Invalid response format/);
  } finally { global.fetch = realFetch; }
});

test('a reasoning-only stream explains itself instead of an empty-response message', async () => {
  const realFetch = global.fetch;
  const sse = [
    { id: 'x', object: 'chat.completion.chunk', created: 1, model: 'demo', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'thinking hard' }, finish_reason: null }] },
    { id: 'x', object: 'chat.completion.chunk', created: 1, model: 'demo', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
  ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  global.fetch = async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  try {
    const themis = await startThemis({ roles: [{ id: 'a', name: 'A' }] });
    const created = await themis.send({ type: 'EXTERNAL_MODEL_CREATE', name: 'Go', format: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'test-key', modelName: 'demo' });
    const result = await themis.send({ type: 'EXTERNAL_MODEL_TEST', modelId: created.model.id });
    assert.equal(result.ok, false);
    assert.match(result.error, /no text \(finish reason: length, only 13 characters of reasoning\)/);
  } finally { global.fetch = realFetch; }
});

test('OpenCode Go requests carry a stable x-opencode-session header; other providers do not', async () => {
  const realFetch = global.fetch;
  const seen = [];
  const sse = `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'demo', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
  global.fetch = async (url, init) => { seen.push({ url: String(url), session: new Headers(init.headers).get('x-opencode-session') }); return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
  try {
    const themis = await startThemis({ roles: [{ id: 'a', name: 'A' }] });
    for (const baseUrl of ['https://opencode.ai/zen/go/v1', 'https://example.test/v1']) {
      const created = await themis.send({ type: 'EXTERNAL_MODEL_CREATE', name: 'M', format: 'openai', baseUrl, apiKey: 'test-key', modelName: 'demo' });
      const result = await themis.send({ type: 'EXTERNAL_MODEL_TEST', modelId: created.model.id });
      assert.equal(result.ok, true, result.error);
    }
    assert.equal(seen[0].session, `themis-${seen.length && (await themis.store()).settings.externalModelOrder[0]}`);
    assert.equal(seen[1].session, null);
  } finally { global.fetch = realFetch; }
});
