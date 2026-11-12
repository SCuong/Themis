const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const bundle = readFileSync(require.resolve('./content.js'), 'utf8');
const adapter = bundle.slice(bundle.indexOf('unified-composer'));
const composer = adapter.split("',sendButton:")[0];
const responses = adapter.match(/response:'([^']+)',imageResponse:/)?.[1];

test('ChatGPT accepts the legacy and current rich-text composers', () => {
  assert.ok(composer.includes('#prompt-textarea.ProseMirror[contenteditable="true"]'));
  assert.ok(composer.includes('form[data-chatgpt-composer] .ProseMirror[contenteditable="true"][data-composer-markdown]'));
});

test('ChatGPT recognizes legacy and current assistant message markup', () => {
  assert.deepEqual(responses?.split(', '), [
    '[data-message-author-role="assistant"]',
    '[data-markdown-text-style="assistant-message"]',
  ]);
});
