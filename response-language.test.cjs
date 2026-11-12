const assert = require('node:assert/strict');
const { test } = require('node:test');
const { importSource } = require('./test-support/source.cjs');

test('English and Vietnamese prompt locales prioritize the persona over the interface language', async () => {
  const shared = await importSource('test-support/shared.ts');
  assert.deepEqual(Object.keys(shared.PROMPT_I18N).sort(), ['en', 'vi']);
  assert.match(shared.PROMPT_I18N.en.responseLanguageInstruction, /requested by the user.*specified by your persona.*neither.*English/);
  assert.match(shared.PROMPT_I18N.vi.responseLanguageInstruction, /người dùng yêu cầu.*ngôn ngữ trong persona.*cả hai.*tiếng Việt/);
});

test('new provider prompts use Vietnamese or English in both chat modes', async () => {
  const shared = await importSource('test-support/shared.ts');
  const { buildPrompt } = await importSource('test-support/background.ts');
  for (const language of ['vi', 'en', 'zh-CN']) {
    for (const mode of ['collaborative', 'independent']) {
      const role = { name: 'Engineer', systemPrompt: 'Luôn trả lời bằng tiếng Việt.' };
      const prompt = buildPrompt({ chat: { mode }, role, roles: [role], language, userMessage: { content: 'Test prompt' } });
      assert.match(prompt, /Luôn trả lời bằng tiếng Việt\./);
      assert.match(prompt, /Test prompt/);
      assert.doesNotMatch(prompt, /\p{Script=Han}/u);
      assert.ok(prompt.includes(shared.PROMPT_I18N[shared.normalizeLanguage(language)].responseLanguageInstruction));
    }
  }
});

test('site prompts send the persona until that exact persona is acknowledged in the conversation', async () => {
  const { shouldIncludePersonaForPrompt: includePersona } = await importSource('test-support/background.ts');
  assert.equal(includePersona({ systemPrompt: 'Persona' }, 'sig'), true);
  assert.equal(includePersona({ systemPrompt: 'Persona', promptSync: { signature: 'sig' } }, 'sig'), false);
  assert.equal(includePersona({ systemPrompt: 'Edited', promptSync: { signature: 'old' } }, 'new'), true);
  // A custom GPT on ChatGPT carries its own persona.
  assert.equal(includePersona({ systemPrompt: 'Persona', chatSite: 'chatgpt', chatGptGptsUrl: 'https://chatgpt.com/g/custom' }, 'sig'), false);
});
