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

const TOP = 'chrome-extension://test';
const grokCookie = (name, value, sameSite = 'lax') => ({ name, value, domain: '.grok.com', path: '/', sameSite, secure: true, httpOnly: true, session: false, expirationDate: 2e9 });
// Partitioned grok.com cookies under the Themis page, as name=value/sameSite@path.
const copies = team => team.cookieJar.filter(c => c.partitionKey?.topLevelSite === TOP).map(c => `${c.name}=${c.value}/${c.sameSite}@${c.path}`).sort();

test('Grok\'s Lax and Strict cookies get SameSite=None copies partitioned to Themis while a workspace tab is open', async () => {
  const team = await startThemis({ roles: [] });
  team.cookieJar.push(grokCookie('sso', 's1'), grokCookie('sso-rw', 'w1', 'strict'), grokCookie('cf_clearance', 'c1', 'no_restriction'));
  team.tabs.push({ id: 5, url: TEAM });
  await team.fireTab('onUpdated', 5, { status: 'loading' });
  // cf_clearance is already sent cross-site, so it needs no copy.
  assert.deepEqual(copies(team), ['sso-rw=w1/no_restriction@/', 'sso=s1/no_restriction@/']);
  assert.deepEqual(team.cookieJar.filter(c => !c.partitionKey).map(c => `${c.sameSite}@${c.path}`), ['lax@/', 'strict@/', 'no_restriction@/'], 'Grok\'s own cookies are untouched');

  // Rotation and sign-out follow the originals; changes to the copies themselves are ignored.
  team.cookieJar[0].value = 's2';
  await team.fireCookie({ cookie: team.cookieJar[0] });
  team.cookieJar.splice(1, 1);
  await team.fireCookie({ cookie: { name: 'sso-rw', domain: '.grok.com' }, removed: true });
  assert.deepEqual(copies(team), ['sso=s2/no_restriction@/']);

  // Closing the last workspace tab deletes every copy.
  team.tabs.splice(0, 1);
  await team.fireTab('onRemoved', 5, {});
  assert.deepEqual(copies(team), []);
  assert.deepEqual(await team.sessionRules(), []);
});

test('a cookie Chrome refuses to copy does not stop the others', async () => {
  const team = await startThemis({ roles: [] });
  team.cookieJar.push(grokCookie('bad', 'x'), grokCookie('sso', 's1'));
  const set = chrome.cookies.set;
  chrome.cookies.set = async details => { if (details.name === 'bad') throw new Error('refused'); return set(details); };
  team.tabs.push({ id: 5, url: TEAM });
  await team.fireTab('onUpdated', 5, { status: 'loading' });
  assert.deepEqual(copies(team), ['sso=s1/no_restriction@/']);
});

test('cookies of other sites are never copied', async () => {
  const team = await startThemis({ roles: [] });
  team.cookieJar.push({ ...grokCookie('session', 'x'), domain: '.example.com' });
  team.tabs.push({ id: 5, url: TEAM });
  await team.fireTab('onUpdated', 5, { status: 'loading' });
  assert.deepEqual(copies(team), []);
});

test('partitioned cookies grok.com set itself (Cloudflare) are left alone', async () => {
  const team = await startThemis({ roles: [] });
  team.cookieJar.push(grokCookie('sso', 's1'), { ...grokCookie('cf_clearance', 'cf', 'no_restriction'), partitionKey: { topLevelSite: TOP } });
  team.tabs.push({ id: 5, url: TEAM });
  await team.fireTab('onUpdated', 5, { status: 'loading' });
  assert.deepEqual(copies(team), ['cf_clearance=cf/no_restriction@/', 'sso=s1/no_restriction@/']);
  team.tabs.splice(0, 1);
  await team.fireTab('onRemoved', 5, {});
  assert.deepEqual(copies(team), ['cf_clearance=cf/no_restriction@/'], 'only the copies Themis made are deleted');
});

