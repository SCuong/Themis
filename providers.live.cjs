// Live check against the real AI sites: runs content.js's own site adapter in each page, sends one short
// prompt and waits for the reply. Catches site markup changes that the JSDOM fixture tests cannot.
//
//   npm run test:live:login   opens Chrome on a dedicated profile; sign in to each site, then close it
//   npm run test:live         runs the check (THEMIS_LIVE_SITES=chatgpt,claude to pick sites)
//
// Not part of `npm test` or CI: it needs signed-in accounts and uses a little of each site's quota.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test, after } = require('node:test');
const { chromium } = require('playwright-core');

const SITES = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com/',
  grok: 'https://grok.com/',
};
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = process.env.THEMIS_LIVE_PROFILE || path.join(__dirname, 'test-results', 'live-profile');
const picked = (process.env.THEMIS_LIVE_SITES || Object.keys(SITES).join(',')).split(',').map(s => s.trim()).filter(Boolean);

const source = readFileSync(require.resolve('./content.js'), 'utf8');
const end = source.indexOf('var Tt="__THEMIS_LOADED__"');
// Same cut as provider-dom.test.cjs: the adapter code, without extension boot and runtime messaging.
const adapterScript = source.slice(0, end) + 'window.__themisAdapter=Et();})();';

async function launch() {
  // Headed: several sites refuse headless browsers.
  return chromium.launchPersistentContext(profile, { executablePath: chrome, headless: false, viewport: { width: 1280, height: 900 } });
}

if (process.argv.includes('--login')) {
  (async () => {
    const context = await launch();
    for (const url of Object.values(SITES)) await (await context.newPage()).goto(url).catch(() => {});
    console.log(`Sign in to each site in the Chrome window, then close it. Profile: ${profile}`);
    await new Promise(resolve => context.on('close', resolve));
  })();
} else {
  assert.ok(end > 0, 'content.js layout changed: adapter boot marker not found');
  let context;
  after(() => context?.close());

  for (const site of picked) {
    test(`${site}: the real page accepts a prompt and the adapter reads the reply`, { timeout: 180000 }, async () => {
      assert.ok(SITES[site], `unknown site ${site}`);
      context ??= await launch();
      const page = await context.newPage();
      await page.goto(SITES[site], { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000); // let the app shell render
      await page.evaluate(adapterScript);
      const token = `THEMIS-${Date.now().toString(36).toUpperCase()}`;
      const before = await page.evaluate(() => window.__themisAdapter.getAllAssistantReplies().length);
      await page.evaluate(text => window.__themisAdapter.fillAndSend(text), `Reply with exactly this text and nothing else: ${token}`);
      await page.waitForFunction(
        ({ before, token }) => {
          const a = window.__themisAdapter;
          const replies = a.getAllAssistantReplies();
          return !a.isGenerating() && replies.length > before && replies.some(r => r.includes(token));
        },
        { before, token },
        { timeout: 150000, polling: 1000 },
      ).catch(async error => {
        const replies = await page.evaluate(() => window.__themisAdapter.getAllAssistantReplies()).catch(() => []);
        throw new Error(`${site}: no reply containing ${token} (signed in? markup changed?). Last replies: ${JSON.stringify(replies.slice(-2))}. ${error.message}`);
      });
    });
  }
}
