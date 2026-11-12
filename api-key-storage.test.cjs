// External-model API keys never reach chrome.storage in plaintext, and load back unchanged.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

test('API keys are sealed at rest and opened on load', async () => {
  const memory = {};
  global.chrome = { storage: { local: {
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(memory);
      return Object.fromEntries([].concat(keys).filter(k => k in memory).map(k => [k, structuredClone(memory[k])]));
    },
    async set(values) { Object.assign(memory, structuredClone(values)); },
    async remove(keys) { for (const k of [].concat(keys)) delete memory[k]; },
  } } };
  const repo = await import(pathToFileURL(require.resolve('./assets/imageAttachmentRepository-DBrzc-g8.js')).href);
  const store = repo.C();
  store.settings.externalModelOrder = ['m'];
  store.settings.externalModelsById.m = { id: 'm', name: 'Mine', format: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: 'sk-secret-123', modelName: 'x', createdAt: 1, updatedAt: 1 };
  await repo.F(store);

  const raw = JSON.stringify(memory);
  assert.ok(!raw.includes('sk-secret-123'), 'plaintext key is not written to storage');
  assert.match(raw, /themis-sealed:v1:/);
  assert.equal(store.settings.externalModelsById.m.apiKey, 'sk-secret-123', 'the caller\'s store is not mutated');

  const loaded = await repo.l();
  assert.equal(loaded.settings.externalModelsById.m.apiKey, 'sk-secret-123');

  // Saving again does not double-seal, and an old plaintext key is sealed on the next save.
  await repo.F(loaded);
  assert.equal((await repo.l()).settings.externalModelsById.m.apiKey, 'sk-secret-123');
});
