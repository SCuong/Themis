// End-to-end check of the whole extension against the real AI sites: loads Themis unpacked in Playwright's
// Chromium (branded Chrome ignores --load-extension), creates a group chat in team.html through the real UI,
// adds one member per site, sends one prompt and checks that each member's reply shows up under that member.
//
//   npx playwright-core install chromium   (once)
//   npm run test:e2e:login   opens the 5 sites in the E2E profile, in Chromium without automation; sign in by hand, then close it
//   npm run test:e2e         runs the check (THEMIS_E2E_SITES=chatgpt,gemini to pick sites)
//
// Result per site: PASS (a real reply carrying that member's token reached the Themis UI), FAIL, or BLOCKED
// (a bot check or a missing sign-in kept the prompt from being answered; see the screenshot).
// Summary, screenshots and console errors go to test-results/e2e/. Not part of `npm test` or CI: it needs
// signed-in accounts and uses a little of each site's quota. Runs headed, since several sites refuse headless.
const { mkdirSync, writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright-core');

const SITES = {
  chatgpt: { url: 'https://chatgpt.com/', host: 'chatgpt.com' },
  claude: { url: 'https://claude.ai/new', host: 'claude.ai' },
  gemini: { url: 'https://gemini.google.com/app', host: 'gemini.google.com' },
  deepseek: { url: 'https://chat.deepseek.com/', host: 'chat.deepseek.com' },
  grok: { url: 'https://grok.com/', host: 'grok.com' },
};
const root = __dirname;
const profile = process.env.THEMIS_E2E_PROFILE || path.join(root, 'test-results', 'e2e-profile');
const out = path.join(root, 'test-results', 'e2e');
const sites = (process.env.THEMIS_E2E_SITES || Object.keys(SITES).join(',')).split(',').map(s => s.trim()).filter(Boolean);
const REPLY_TIMEOUT_MS = Number(process.env.THEMIS_E2E_TIMEOUT_MS || 240000);
// DeepSeek's WAF leaves only "Please refresh the page to try again!" in automated browsers.
const BOT_CHECK = /please refresh the page to try again|just a moment|verify you are human|checking your browser|performing security verification|403 error|request blocked|the request could not be satisfied|access denied/i;
const SIGN_IN = /\b(log ?in|sign ?in|sign ?up|continue with google)\b/i;

const launch = () => chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: process.env.THEMIS_E2E_HEADLESS === '1',
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});

// Starts the same Chromium binary on the same profile, but without Playwright: no automation flags or
// DevTools pipe, so Google sign-in and Cloudflare treat it like an ordinary browser. Themis stays loaded:
// opening the profile without it makes Chrome mark the unpacked extension disabled for later runs too.
async function login() {
  mkdirSync(profile, { recursive: true });
  const browser = spawn(chromium.executablePath(), [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${root}`, `--load-extension=${root}`, ...Object.values(SITES).map(s => s.url)], { stdio: 'ignore' });
  console.log(`Sign in to each site in the browser window, then close it. Profile: ${profile}`);
  await new Promise((resolve, reject) => { browser.on('exit', resolve); browser.on('error', reject); });
}

// Which bucket a console message belongs to: the service worker, a site frame, or the team page.
function sourceOf(url) {
  if (/^chrome-extension:\/\/[^/]+\/background\.js/.test(url)) return 'serviceWorker';
  const site = Object.entries(SITES).find(([, s]) => url.includes(`://${s.host}`) || url.includes(`.${s.host}`));
  return site ? site[0] : 'page';
}

// Themis titles each member's iframe "<member> <site> chat", which ties a frame to exactly one member.
const frameOf = async (page, m) => (await page.$(`#iframe-host iframe.role-frame[title^="${m.name} "]`))?.contentFrame() ?? null;
const frameText = frame => frame ? frame.evaluate(() => document.body?.innerText || '').catch(() => '') : '';

// The frames sit in a fixed layer behind the workspace; lift it on top just long enough to screenshot one.
async function shootFrame(page, m, file) {
  const iframe = await page.$(`#iframe-host iframe.role-frame[title^="${m.name} "]`);
  if (!iframe) return null;
  await page.evaluate(() => { document.getElementById('iframe-host').style.zIndex = '2147483647'; });
  try {
    await iframe.scrollIntoViewIfNeeded().catch(() => {});
    await iframe.screenshot({ path: file, timeout: 10000 });
    return path.relative(out, file);
  } catch { return null; }
  finally { await page.evaluate(() => { document.getElementById('iframe-host').style.zIndex = ''; }); }
}

async function run() {
  mkdirSync(out, { recursive: true });
  const stamp = Date.now().toString(36).toUpperCase();
  const members = sites.map(site => {
    if (!SITES[site]) throw new Error(`unknown site ${site}`);
    return { site, name: `E2E${site[0].toUpperCase()}${site.slice(1)}`, token: `THEMIS-${site.toUpperCase()}-${stamp}` };
  });
  const errors = { page: [], serviceWorker: [], ...Object.fromEntries(sites.map(s => [s, []])) };
  const keep = (bucket, text) => { (errors[bucket] ?? errors.page).push(text.slice(0, 500)); };

  const context = await launch();
  const result = { startedAt: new Date().toISOString(), stamp, profile, providers: [] };
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    context.on('console', msg => { if (msg.type() === 'error') keep(sourceOf(msg.location().url || ''), msg.text()); });
    context.on('weberror', e => keep(sourceOf(e.page()?.url() || ''), String(e.error())));
    const page = await context.newPage();
    page.on('pageerror', e => keep('page', String(e)));
    // Start from an empty Themis store so chats from earlier runs don't load their frames too; the sites'
    // sign-ins live in cookies and stay.
    await worker.evaluate(() => chrome.storage.local.clear());
    await page.goto(`chrome-extension://${extensionId}/team.html`);
    await page.locator('#quick-create-chat').waitFor();
    // Without the per-tab frame rule every site refuses the iframe, which would read as five FAILs.
    const ruleEnd = Date.now() + 10000;
    while (!(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()).catch(() => [])).length) {
      if (Date.now() > ruleEnd) throw new Error('Themis added no frame rule for the workspace tab; is the extension enabled in this profile?');
      await page.waitForTimeout(250);
    }

    // Group chat and members, through the same controls a user clicks.
    await page.locator('#quick-create-chat').click();
    await page.locator('#new-chat-name').fill(`E2E ${stamp}`);
    await page.locator('#create-chat-form button[type=submit]').click();
    await page.locator('#chat-title', { hasText: `E2E ${stamp}` }).waitFor();
    await page.locator('#toggle-people-drawer').click();
    await page.locator('#add-role-form button[type=submit]').click();
    for (const m of members) {
      await page.locator('#open-temporary-person').click();
      await page.locator('#temporary-person-name').fill(m.name);
      await page.locator('#temporary-person-prompt').fill('A test member. Follow the instructions in each message exactly.');
      await page.locator('#add-temporary-person-form button[type=submit]').click();
      const row = page.locator('#add-library-people-list .select-row', { hasText: m.name });
      await row.locator('> input[type=checkbox]').check();
      // The site picker starts with a default site and keeps at least one active, so turn this member's site
      // on first, then the others off.
      for (const s of [m.site, ...Object.keys(SITES).filter(s => s !== m.site)]) {
        const pill = row.locator(`label.site-pill-${s}`);
        if (((await pill.getAttribute('class')) || '').includes('active') !== (s === m.site)) await pill.click();
      }
    }
    await page.locator('#add-library-people-form button[type=submit]').click();
    for (const m of members) await page.locator('#role-list .role-name', { hasText: m.name }).waitFor({ state: 'attached' });
    result.roles = await page.locator('#role-list .role-name').evaluateAll(els => els.map(el => el.title));

    // Let each site frame load, then note what stands in the way before sending anything.
    const loadEnd = Date.now() + 45000;
    while (Date.now() < loadEnd && (await Promise.all(members.map(m => frameOf(page, m)))).some(f => !f)) await page.waitForTimeout(1000);
    await page.waitForTimeout(15000); // app shells, Cloudflare and sign-in redirects settle
    for (const m of members) {
      const frame = await frameOf(page, m);
      const text = await frameText(frame);
      const challenge = frame?.childFrames().some(f => f.url().includes('challenges.cloudflare.com'));
      m.preflight = { frameUrl: frame?.url() ?? null, botCheck: Boolean(challenge || BOT_CHECK.test(text)), signInPrompt: SIGN_IN.test(text) };
      m.status = (await page.locator('#role-list .role-card', { hasText: m.name }).locator('.status-pill').innerText().catch(() => '')).trim();
    }

    const prompt = [
      `@all Themis end-to-end test ${stamp}.`,
      'Every member: reply with ONLY your own token from this list, nothing else.',
      ...members.map(m => `${m.name}: ${m.token}`),
    ].join('\n');
    await page.locator('#message-input').fill(prompt);
    const targets = (await page.locator('#target-preview').innerText().catch(() => '')).trim();
    const sentAt = Date.now();
    await page.locator('#send-message').click();

    // Wait for every member's reply row; a row counts only if it is under that member and carries its token.
    const pending = new Set(members);
    const deadline = sentAt + REPLY_TIMEOUT_MS;
    while (pending.size && Date.now() < deadline) {
      for (const m of [...pending]) {
        const row = page.locator('.message-row').filter({ has: page.locator('.message-name-text', { hasText: m.name }) }).filter({ hasText: m.token });
        if (await row.count()) { m.responseMs = Date.now() - sentAt; m.uiReply = (await row.last().innerText()).slice(0, 500); pending.delete(m); }
        if (!m.promptReached) m.promptReached = (await frameText(await frameOf(page, m))).includes(stamp);
      }
      if (pending.size) await page.waitForTimeout(2000);
    }

    await page.locator('#chat-list').getByText(`E2E ${stamp}`).first().click().catch(() => {}); // keep our chat in view
    await page.screenshot({ path: path.join(out, 'team.png') });
    for (const m of members) {
      const frame = await frameOf(page, m);
      const text = await frameText(frame);
      m.screenshot = await shootFrame(page, m, path.join(out, `${m.site}.png`));
      // The reply also got rendered by the site itself (beyond the prompt, which lists every token once).
      m.replyInFrame = text.split(m.token).length - 1 > 1;
      // What Themis showed under this member, token or not (e.g. its own "Response failed: ..." notice).
      m.lastUiRow ??= await page.locator('.message-row').filter({ has: page.locator('.message-name-text', { hasText: m.name }) }).last().innerText({ timeout: 1000 }).then(t => t.slice(0, 500)).catch(() => null);
      const botCheck = m.preflight.botCheck || BOT_CHECK.test(text);
      const verdict = m.uiReply ? 'PASS'
        : !frame ? 'FAIL'
        : botCheck ? 'BLOCKED'
        : !m.promptReached && m.preflight.signInPrompt ? 'BLOCKED'
        : 'FAIL';
      const reason = m.uiReply ? 'reply with the member token shown under the member in Themis'
        : !frame ? 'no frame for this site appeared in the workspace'
        : botCheck ? 'bot check (Cloudflare/CloudFront) on the site frame'
        : verdict === 'BLOCKED' ? 'site shows a sign-in prompt and the prompt never reached its composer'
        : m.promptReached ? `prompt reached the site but no reply with ${m.token} appeared under ${m.name} within ${REPLY_TIMEOUT_MS / 1000}s`
        : 'prompt never reached the site frame';
      // The row reads "<member>\n<site>\n<reply>"; keep the reply's first line.
      const shown = !m.uiReply && m.lastUiRow?.split('\n').filter(Boolean)[2];
      result.providers.push({
        site: m.site, member: m.name, token: m.token, verdict, reason: shown ? `${reason}. Themis shows: ${shown.slice(0, 160)}` : reason,
        responseMs: m.responseMs ?? null, promptReached: Boolean(m.promptReached), replyRead: Boolean(m.uiReply), replyInFrame: m.replyInFrame,
        memberStatus: m.status, preflight: m.preflight, uiReply: m.uiReply ?? null, lastUiRow: m.lastUiRow, screenshot: m.screenshot,
        consoleErrors: errors[m.site],
      });
    }
    result.targetPreview = targets;
    result.teamScreenshot = 'team.png';
  } catch (error) {
    result.error = String(error?.stack || error);
    await context.pages().at(-1)?.screenshot({ path: path.join(out, 'team.png') }).catch(() => {});
  } finally {
    result.finishedAt = new Date().toISOString();
    result.consoleErrors = { page: errors.page, serviceWorker: errors.serviceWorker };
    await context.close().catch(() => {});
  }

  writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2));
  const lines = [
    `# Themis live E2E (${result.startedAt})`, '',
    result.error ? `**Run aborted:** \`${result.error.split('\n')[0]}\`\n` : '',
    '| Site | Verdict | Response | Prompt reached | Reply in UI | Console errors | Reason |',
    '|---|---|---|---|---|---|---|',
    ...result.providers.map(p => `| ${p.site} | **${p.verdict}** | ${p.responseMs == null ? '–' : `${(p.responseMs / 1000).toFixed(1)}s`} | ${p.promptReached ? 'yes' : 'no'} | ${p.replyRead ? 'yes' : 'no'} | ${p.consoleErrors.length} | ${p.reason} |`),
    '', `Team page console errors: ${result.consoleErrors.page.length}; service worker: ${result.consoleErrors.serviceWorker.length}.`,
    '', 'Screenshots: `team.png` and one `<site>.png` per frame in this folder. Details: `summary.json`.',
  ];
  writeFileSync(path.join(out, 'summary.md'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  // Anything short of PASS everywhere misses the acceptance target.
  process.exitCode = !result.error && result.providers.length === sites.length && result.providers.every(p => p.verdict === 'PASS') ? 0 : 1;
}

(process.argv.includes('--login') ? login() : run()).catch(error => { console.error(error); process.exitCode = 1; });
