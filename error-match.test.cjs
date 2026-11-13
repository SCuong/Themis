const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { importSource } = require('./test-support/source.cjs');

const src = file => readFileSync(path.join(__dirname, 'src', file), 'utf8');

// The team page recognises these background errors to auto-reconnect a member; keep the texts in sync.
test('the team page recovery check matches the errors the background throws', async () => {
  const { isUnavailableRolesError } = await importSource('src/teamPage/chatExperience.ts');
  const background = src('background/messageHandlers.ts') + src('background/rolePromptDelivery.ts');
  const thrown = [
    'The following members are unavailable. Please wait or restore them: Engineer',
    'The member iframe is not ready. Please restore the member first',
  ];
  for (const message of thrown) {
    assert.ok(background.includes(message.split(':')[0].replace(/ Engineer$/, '')), `background no longer throws: ${message}`);
    assert.equal(isUnavailableRolesError(message), true, `team page no longer recognises: ${message}`);
  }
});

test('automatic orchestration uses its own message as the task when the task field is empty', () => {
  assert.match(src('teamPage/orchestrationModalView.ts'), /if \(!task && autoInstruction\.trim\(\)\) \{\s*task = autoInstruction\.trim\(\)/);
});
