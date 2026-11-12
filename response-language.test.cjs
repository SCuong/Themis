const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { parse } = require('acorn');

test('English and Vietnamese prompt locales prioritize the persona over the interface language', async () => {
  const shared = await import('./assets/imageAttachmentRepository-DBrzc-g8.js');
  assert.deepEqual(Object.keys(shared.P).sort(), ['en', 'vi']);
  assert.match(shared.P.en.responseLanguageInstruction, /requested by the user.*specified by your persona.*neither.*English/);
  assert.match(shared.P.vi.responseLanguageInstruction, /người dùng yêu cầu.*ngôn ngữ trong persona.*cả hai.*tiếng Việt/);
});

test('new provider prompts use Vietnamese or English in both chat modes', async () => {
  const shared = await import('./assets/imageAttachmentRepository-DBrzc-g8.js');
  const source = readFileSync(require.resolve('./background.js'), 'utf8');
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const builders = new Set(['yf', 'lk', 'ck', '_o', 'vf', 'fk', 'wf', 'mk', 'hk', 'Vr']);
  const functions = tree.body.filter(node => node.type === 'FunctionDeclaration' && builders.has(node.id.name));
  assert.equal(functions.length, builders.size);
  const makePrompt = runInNewContext(functions.map(node => source.slice(node.start, node.end)).join('\n') + '\nyf', {
    wt: shared.n, We: shared.P,
  });
  for (const language of ['vi', 'en', 'zh-CN']) {
    for (const mode of ['collaborative', 'independent']) {
      const role = { name: 'Engineer', systemPrompt: 'Luôn trả lời bằng tiếng Việt.' };
      const prompt = makePrompt({ chat: { mode }, role, roles: [role], language, userMessage: { content: 'Test prompt' } });
      assert.match(prompt, /Luôn trả lời bằng tiếng Việt\./);
      assert.match(prompt, /Test prompt/);
      assert.doesNotMatch(prompt, /\p{Script=Han}/u);
      assert.ok(prompt.includes(shared.P[shared.n(language)].responseLanguageInstruction));
    }
  }
});

test('site prompts send the persona until that exact persona is acknowledged in the conversation', () => {
  const bundle = readFileSync(require.resolve('./background.js'), 'utf8');
  const predicate = bundle.match(/function kk\([^}]+\}/)?.[0];
  assert.ok(predicate);
  const includePersona = runInNewContext(`(${predicate})`, {
    _f: role => Boolean(role.chatGptGptsUrl),
  });
  assert.equal(includePersona({ systemPrompt: 'Persona' }, 'sig'), true);
  assert.equal(includePersona({ systemPrompt: 'Persona', promptSync: { signature: 'sig' } }, 'sig'), false);
  assert.equal(includePersona({ systemPrompt: 'Edited', promptSync: { signature: 'old' } }, 'new'), true);
  assert.equal(includePersona({ systemPrompt: 'Persona', chatGptGptsUrl: 'custom' }, 'sig'), false);
});
