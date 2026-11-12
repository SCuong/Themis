// The AI sites' frame protection (CSP / X-Frame-Options) is relaxed only inside Themis workspace tabs.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { startThemis } = require('./prompt-sync-harness.cjs');

after(() => setImmediate(() => process.exit(0))); // background.js keeps keepalive timers alive

const TEAM = 'chrome-extension://test/team.html';
const ruleTabs = async team => (await team.sessionRules()).flatMap(r => r.condition.tabIds ?? []);

test('only Themis workspace tabs get the exception, for the AI sites and frames only', async () => {
  const team = await startThemis({ roles: [] });
  team.tabs.push({ id: 5, url: TEAM }, { id: 6, url: 'https://example.com/' }, { id: 7, url: `${TEAM}?chat=a` });
  await team.fireTab('onUpdated', 5, { status: 'loading' });
  const [rule, ...rest] = await team.sessionRules();
  assert.equal(rest.length, 0);
  assert.deepEqual(rule.condition.tabIds, [5, 7], 'an ordinary tab (6) keeps the sites\' protection');
  assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
  assert.deepEqual(rule.condition.requestDomains, ['gemini.google.com', 'chatgpt.com', 'chat.openai.com', 'claude.ai', 'chat.deepseek.com', 'grok.com']);
  assert.equal(rule.condition.initiatorDomains, undefined, 'navigation inside the frames stays covered');
  assert.deepEqual(rule.action.responseHeaders.map(h => [h.header, h.operation]), [['content-security-policy', 'remove'], ['x-frame-options', 'remove']]);
});

test('a tab still loading team.html (pendingUrl) is covered before its frames load', async () => {
  const team = await startThemis({ roles: [] });
  team.tabs.push({ id: 9, url: '', pendingUrl: TEAM });
  await team.fireTab('onCreated', { id: 9 });
  assert.deepEqual(await ruleTabs(team), [9]);
});

test('closing the workspace tab revokes its exception', async () => {
  const team = await startThemis({ roles: [] });
  team.tabs.push({ id: 5, url: TEAM }, { id: 7, url: TEAM });
  await team.fireTab('onUpdated', 5, { status: 'loading' });
  team.tabs.splice(0, 1);
  await team.fireTab('onRemoved', 5, {});
  assert.deepEqual(await ruleTabs(team), [7]);
  team.tabs.splice(0, 1);
  await team.fireTab('onRemoved', 7, {});
  assert.deepEqual(await team.sessionRules(), [], 'no rule at all without a workspace tab');
});

test('navigating the workspace tab to another site revokes its exception', async () => {
  const team = await startThemis({ roles: [] });
  team.tabs.push({ id: 5, url: TEAM });
  await team.fireTab('onUpdated', 5, { status: 'loading' });
  team.tabs[0].url = 'https://evil.example/';
  await team.fireTab('onUpdated', 5, { url: 'https://evil.example/' });
  assert.deepEqual(await team.sessionRules(), []);
});
