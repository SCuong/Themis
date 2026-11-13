// Real-browser check of the per-tab frame rules: loads Themis unpacked in Playwright's Chromium (branded
// Chrome ignores --load-extension) and embeds the real AI sites.
//   npx playwright-core install chromium   (once)
//   npm run test:frames
// Needs network access to the AI sites; no sign-in. Screenshots go to test-results/frames/.
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright-core');

const SITES = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/',
  gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com/',
  grok: 'https://grok.com/',
};
const OUTSIDE = 'https://frame-test.example/'; // a stand-in for any ordinary website, served locally
const root = path.join(__dirname, 'dist'); // the built extension (npm run build)
const shots = path.join(__dirname, 'test-results', 'frames');
let context, worker, profile, extensionId;

before(async () => {
  mkdirSync(shots, { recursive: true });
  profile = mkdtempSync(path.join(os.tmpdir(), 'themis-frames-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  await context.route(`${OUTSIDE}**`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>outside</title>' }));
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
});
after(async () => {
  await context?.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

const rules = () => worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
// The newest tab showing this page's URL (tab ids only grow).
const tabIdOf = page => worker.evaluate(url => chrome.tabs.query({}).then(tabs => [Math.max(...tabs.filter(t => t.url === url).map(t => t.id))]), page.url());
const teamUrl = () => `chrome-extension://${extensionId}/team.html`;
async function until(check, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); }
  assert.fail(`timed out: ${what}`);
}

// Embeds the site in the page and reports whether the frame rendered the site or Chrome's blocked-frame page.
async function embed(page, name, url) {
  await page.evaluate(([name, url]) => {
    const f = document.createElement('iframe');
    f.name = name; f.src = url; f.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;border:0;background:#fff'; // on top, so the screenshot shows the frame
    document.body.append(f);
  }, [name, url]);
  await page.waitForTimeout(6000);
  // A frame Chrome blocked loses its name and URL, so take the newest child frame instead.
  const frame = page.mainFrame().childFrames().at(-1);
  return { frame, loaded: frame?.url().startsWith('https://') === true, url: frame?.url() };
}

test('a Themis workspace tab gets a session rule for exactly its own tab', { timeout: 90000 }, async () => {
  const team = await context.newPage();
  await team.goto(teamUrl());
  const [tabId] = await tabIdOf(team);
  await until(async () => (await rules()).some(r => r.condition.tabIds?.includes(tabId)), 'rule for the team tab');
  const [rule] = await rules();
  assert.deepEqual(rule.condition.tabIds, [tabId]);
  await team.close();
});

for (const [name, url] of Object.entries(SITES)) {
  test(`${name}: embeds in the Themis tab, stays blocked in an ordinary tab, and survives navigation inside the frame`, { timeout: 90000 }, async t => {
    const team = await context.newPage();
    try {
    await team.goto(teamUrl());
    const [tabId] = await tabIdOf(team);
    await until(async () => (await rules()).some(r => r.condition.tabIds?.includes(tabId)), 'rule for the team tab');

    const inTeam = await embed(team, name, url);
    await team.screenshot({ path: path.join(shots, `${name}-themis-tab.png`) });
    assert.ok(inTeam.loaded, `${name} did not render inside the Themis tab (${inTeam.url})`);

    // Navigation inside the embedded site keeps working.
    const target = new URL('/?themis-frame-check=1', inTeam.url).href;
    await inTeam.frame.evaluate(href => { location.href = href; }, target).catch(() => {}); // the context dies as it navigates
    await team.waitForTimeout(6000);
    const after = team.mainFrame().childFrames().at(-1)?.url() ?? '';
    assert.ok(after.startsWith('https://'), `${name} broke after navigating inside the frame (${after || 'blank'})`);

    const outside = await context.newPage();
    try {
      await outside.goto(OUTSIDE);
      // Whether the site itself forbids framing; a site that does not (DeepSeek) is framable anywhere, Themis or not.
      const documentResponse = outside.waitForResponse(r => r.request().resourceType() === 'document' && r.frame() !== outside.mainFrame(), { timeout: 30000 }).catch(() => undefined);
      const inOrdinary = await embed(outside, name, url);
      await outside.screenshot({ path: path.join(shots, `${name}-ordinary-tab.png`) });
      const headers = (await documentResponse)?.headers() ?? {};
      const protects = /deny|sameorigin/i.test(headers['x-frame-options'] ?? '') || /frame-ancestors/i.test(headers['content-security-policy'] ?? '');
      if (protects) assert.ok(!inOrdinary.loaded, `${name} rendered inside an ordinary website's frame (${inOrdinary.url})`);
      else t.diagnostic(`${name} sends no X-Frame-Options or frame-ancestors, so it is framable in any tab; nothing for Themis to restore`);
    } finally { await outside.close(); }
    } finally { await team.close(); }
  });
}

test('closing the Themis tab revokes its rule', { timeout: 90000 }, async () => {
  const team = await context.newPage();
  await team.goto(teamUrl());
  const [tabId] = await tabIdOf(team);
  await until(async () => (await rules()).some(r => r.condition.tabIds?.includes(tabId)), 'rule for the team tab');
  await team.close();
  await until(async () => !(await rules()).some(r => r.condition.tabIds?.includes(tabId)), 'rule revoked after close');
});

test('navigating the Themis tab to another website revokes the exception there', { timeout: 90000 }, async () => {
  const team = await context.newPage();
  await team.goto(teamUrl());
  const [tabId] = await tabIdOf(team);
  await until(async () => (await rules()).some(r => r.condition.tabIds?.includes(tabId)), 'rule for the team tab');
  await team.goto(OUTSIDE);
  await until(async () => !(await rules()).some(r => r.condition.tabIds?.includes(tabId)), 'rule revoked after navigation');
  const framed = await embed(team, 'chatgpt-after-nav', SITES.chatgpt);
  assert.ok(!framed.loaded, `chatgpt still framed after the tab left Themis (${framed.url})`);
  await team.close();
});
