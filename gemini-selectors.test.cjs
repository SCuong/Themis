const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { dist } = require('./test-support/source.cjs');

test('Gemini locates the nested send button without depending on its language', () => {
  const bundle = readFileSync(dist('content.js'), 'utf8');
  const selectors = bundle.match(/sendButton:'(button\.send-button[^']+)',response:"model-response/)?.[1];
  assert.ok(selectors?.includes('button.send-button[aria-label*="Send"]'));
  assert.ok(selectors?.split(', ').includes(
    '[data-test-id="send-button-container"] .send-button.submit button:has([data-mat-icon-name="arrow_upward"])',
  ));
});

test('Gemini prefers message content and keeps fallbacks mutually exclusive', () => {
  const bundle = readFileSync(dist('content.js'), 'utf8');
  const selector = bundle.match(/response:"(model-response[^"]+)",copyButton:/)?.[1];
  assert.equal(selector, 'model-response message-content, model-response .model-response-text:not(:has(message-content)):not(message-content *), model-response:not(:has(message-content, .model-response-text))');
});
