const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

// team.js recognises these background.js errors to auto-reconnect a member; keep the texts in sync.
test('team.js recovery matchers match the errors background.js throws', () => {
  const team = readFileSync(require.resolve('./team.js'), 'utf8');
  const background = readFileSync(require.resolve('./background.js'), 'utf8');
  for (const text of ['iframe is not ready', 'The following members are unavailable. Please wait or restore them']) {
    assert.ok(team.includes(`includes("${text}")`), `team.js no longer checks: ${text}`);
    assert.ok(background.includes(text), `background.js no longer throws: ${text}`);
  }
});

test('automatic orchestration uses its own message as the task when the task field is empty', () => {
  const team = readFileSync(require.resolve('./team.js'), 'utf8');
  assert.ok(team.includes('if(!v&&l.trim()){v=l.trim(),e.orchestrationTaskEl.value=v}if(!v){e.showError("Enter an orchestration task")'));
});
