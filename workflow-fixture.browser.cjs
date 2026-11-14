// Browser check of workflow correctness (BUG #2, #3, #4, #8) in the real built extension.
// Loads dist/ unpacked in Playwright's Chromium on a throwaway profile and drives team.html through its UI.
// Members are API members backed by a FAKE OpenAI-compatible server started here (FIXTURE, not a real
// provider): every request is held until the script releases it, so reply order is chosen by the test.
//
//   npm run build && node workflow-fixture.browser.cjs
//
// Writes test-results/workflow-e2e/{summary.json,summary.md,trace.zip,*.png} (WORKFLOW_E2E_OUT=name picks
// another folder under test-results/). Not part of `npm test`.
// Two steps do not go through clicks: the fake model is registered with EXTERNAL_MODEL_CREATE (the form
// would open Chrome's host-permission prompt, which automation cannot answer) and each graph is stored with
// GROUP_ORCHESTRATION_FLOW_SAVE (drawing X6 edges by drag is not reliable). Both are the same runtime
// messages the UI sends; the run itself is started from the workflow modal's Run button.
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, 'dist');
const out = path.join(__dirname, 'test-results', process.env.WORKFLOW_E2E_OUT || 'workflow-e2e');
const profile = path.join(out, 'profile');
const MEMBERS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Reviewer', 'Fixer', 'Side'];
const PASS = JSON.stringify({ decision: 'pass', reason: 'Meets the bar', failedCriteria: [], nextRoundInstruction: '' });
const FAIL = JSON.stringify({ decision: 'fail', reason: 'Missing detail', failedCriteria: ['detail'], nextRoundInstruction: 'Add detail' });

// ---- fake model server (fixture) ----------------------------------------------------------------
const held = []; // { key, res, at }
const requestLog = [];
function keyOf(body) {
  const text = (body.messages ?? []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  // Collaborative chats replay earlier messages as context, so the newest token names the request.
  const node = [...text.matchAll(/node task:\n\[\[node:([A-Z]\w*)\]\]/g)].at(-1);
  const chat = [...text.matchAll(/\[\[chat:(\w+)\]\]/g)].at(-1);
  if (node && (!chat || node.index > chat.index)) return `node:${node[1]}`;
  return chat ? `chat:${chat[1]}` : 'other';
}
const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const key = keyOf(body);
    requestLog.push({ key, at: Date.now() });
    held.push({ key, res, at: Date.now() });
  });
});
function release(key, text) {
  const index = held.findIndex(h => h.key === key);
  if (index < 0) throw new Error(`no held request for ${key}; held: ${held.map(h => h.key).join(', ')}`);
  const [{ res }] = held.splice(index, 1);
  const chunk = delta => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.write(chunk({ role: 'assistant', content: text }));
  res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
  res.end('data: [DONE]\n\n');
}
const requestsFor = key => requestLog.filter(r => r.key === key).length;
const isHeld = key => held.some(h => h.key === key);

// ---- helpers ------------------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(check, what, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}
const node = (id, member, kind = 'roles') => ({ id, member, kind });

async function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const results = [];
  const consoleErrors = [];
  try {
    const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://')) ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('pageerror', e => consoleErrors.push(String(e)));
    page.on('dialog', dialog => dialog.accept()); // "Clear messages?" confirm
    await page.goto(`chrome-extension://${extensionId}/team.html`);
    await page.locator('#quick-create-chat').waitFor();

    const command = (type, payload = {}) => page.evaluate(([type, payload]) => new Promise(resolve => chrome.runtime.sendMessage({ type, ...payload }, resolve)), [type, payload]);
    const store = async () => (await command('GROUP_STORE_GET')).store;
    const shot = async name => { await page.screenshot({ path: path.join(out, `${name}.png`) }); return `${name}.png`; };

    // Workflows are offered in collaborative chats only.
    await page.locator('#quick-create-chat').click();
    await page.locator('#new-chat-name').fill('Workflow E2E');
    await page.locator('#new-chat-mode-collaborative').check();
    await page.locator('#create-chat-form button[type=submit]').click();
    await page.locator('#chat-title', { hasText: 'Workflow E2E' }).waitFor();
    const created = await command('EXTERNAL_MODEL_CREATE', { name: 'FakeModel', format: 'openai', baseUrl, apiKey: 'fixture-key', modelName: 'fake' });
    if (!created?.ok) throw new Error(`model create failed: ${created?.error}`);

    // Members through the people drawer, then switched to the fake API model from each member card.
    await page.locator('#toggle-people-drawer').click();
    await page.locator('#add-role-form button[type=submit]').click();
    for (const name of MEMBERS) {
      await page.locator('#open-temporary-person').click();
      await page.locator('#temporary-person-name').fill(name);
      await page.locator('#temporary-person-prompt').fill('A test member. Answer briefly.');
      await page.locator('#add-temporary-person-form button[type=submit]').click();
      await page.locator('#add-library-people-list .select-row', { hasText: name }).locator('> input[type=checkbox]').check();
    }
    await page.locator('#add-library-people-form button[type=submit]').click();
    for (const name of MEMBERS) await page.locator('#role-list .role-card', { hasText: name }).waitFor({ state: 'attached' });
    await shot('00-after-add');
    if (!await page.locator('#role-list').isVisible()) await page.locator('#toggle-people-drawer').click();
    for (const name of MEMBERS) {
      const card = page.locator('#role-list .role-card', { hasText: name });
      await card.waitFor();
      await card.locator('.role-site-control .site-pill').click();
      await card.locator('.role-site-option', { hasText: 'FakeModel' }).click();
      await waitFor(async () => Object.values((await store()).rolesById).find(r => r.name === name)?.modelSource === 'external', `${name} on API`);
    }
    const s0 = await store();
    const chatId = s0.currentChatId;
    const roleId = name => Object.values(s0.rolesById).find(r => r.name === name && r.chatId === chatId).id;
    await shot('00-members');

    const activeRun = async () => { const s = await store(); return s.orchestrationRunsById[s.activeOrchestrationRunIdByChatId[chatId]]; };
    const lastRun = async () => Object.values((await store()).orchestrationRunsById).filter(r => r.chatId === chatId).sort((a, b) => b.createdAt - a.createdAt)[0];
    const stageList = run => run.stageRuns.map(s => `${s.stageId}:${s.status}`);
    const waitRunStatus = (status, what) => waitFor(async () => (await lastRun())?.status === status && lastRun(), what);

    async function startFlow(stages, edges, task) {
      const flowStages = stages.map(s => ({
        id: s.id, kind: s.kind, name: s.id, description: `[[node:${s.id}]]`, roleIds: [roleId(s.member)],
        ...(s.kind === 'review' ? { review: { reviewerRoleIds: [roleId(s.member)], instructions: 'Reply with the JSON decision.', maxAttempts: 3 } } : {}),
      }));
      const flowEdges = edges.map(([from, to, port]) => ({ sourceStageId: from, targetStageId: to, ...(port ? { sourcePort: port } : {}) }));
      const saved = await command('GROUP_ORCHESTRATION_FLOW_SAVE', { flow: { id: 'e2e-flow', chatId, name: 'E2E flow', stages: flowStages, graph: { stageNodes: flowStages, edges: flowEdges }, maxNodeExecutions: 20 } });
      if (!saved?.ok) throw new Error(`flow save failed: ${saved?.error}`);
      const before = (await lastRun())?.id;
      await page.locator('#open-orchestration').click();
      await page.locator('#orchestration-modal').waitFor();
      await page.locator('#orchestration-task').fill(task);
      await page.locator('#run-orchestration').click();
      await waitFor(async () => (await lastRun())?.id !== before && (await lastRun()), 'run created');
      await page.locator('#orchestration-modal').waitFor({ state: 'hidden', timeout: 5000 });
    }
    async function sendChat(member, token) {
      await page.locator('#message-input').fill(`@${member} [[chat:${token}]] side question`);
      await page.locator('#mention-panel').waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator('#send-message').click();
      await waitFor(() => isHeld(`chat:${token}`), `normal chat request ${token}`);
    }
    const replyFor = async (name, predicate) => Object.values((await store()).messagesById).find(m => m.chatId === chatId && m.type === 'assistant' && m.roleId === roleId(name) && predicate(m));
    async function scenario(name, fn) {
      if (process.env.ONLY && !name.includes(process.env.ONLY)) return
      const entry = { name, status: 'FAIL', checks: [], screenshots: [] };
      results.push(entry);
      try { await fn(entry); entry.status = 'PASS'; } catch (error) {
        entry.error = String(error.stack ?? error);
        const run = await lastRun();
        const s = await store();
        entry.debug = { run: run && { status: run.status, error: run.error, stages: stageList(run) }, held: held.map(h => h.key), requests: requestLog.map(r => r.key), roles: MEMBERS.map(n => `${n}:${s.rolesById[roleId(n)]?.status}`) };
        entry.screenshots.push(await shot(`${results.length}-${name.replace(/\W+/g, '-')}-error`)); }
      // Leave nothing running for the next scenario.
      if ((await activeRun())?.status === 'running') await command('GROUP_ORCHESTRATION_STOP', { chatId });
      while (held.length) release(held[0].key, 'cleanup');
      await sleep(300);
    }
    const check = (entry, label, ok, detail) => { entry.checks.push({ label, ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) }); if (!ok) throw new Error(`${label}: ${JSON.stringify(detail)}`); };

    // BUG #2: parallel B and C, both completion orders, join D.
    for (const order of [['B', 'C'], ['C', 'B']]) {
      await scenario(`bug2-parallel-${order.join('-then-')}`, async entry => {
        await startFlow([node('A', 'Alpha'), node('B', 'Bravo'), node('C', 'Charlie'), node('D', 'Delta')], [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']], `Parallel ${order.join('')}`);
        await waitFor(() => isHeld('node:A'), 'A request');
        release('node:A', 'A output');
        await waitFor(() => isHeld('node:B') && isHeld('node:C'), 'B and C requests');
        release(`node:${order[0]}`, `${order[0]} output`);
        await waitFor(async () => (await lastRun()).stageRuns.find(s => s.stageId === order[0])?.status === 'completed', `${order[0]} completed`);
        await sleep(500);
        const mid = await lastRun();
        check(entry, `run still running after only ${order[0]} finished`, mid.status === 'running', stageList(mid));
        check(entry, 'D not requested before both branches finish', requestsFor('node:D') === 0, requestsFor('node:D'));
        entry.screenshots.push(await shot(`bug2-${order.join('')}-midway`));
        release(`node:${order[1]}`, `${order[1]} output`);
        await waitFor(() => isHeld('node:D'), 'D request');
        release('node:D', 'D output');
        const done = await waitRunStatus('completed', 'run completed');
        check(entry, 'every node completed exactly once', JSON.stringify(stageList(done).sort()) === JSON.stringify(['A:completed', 'B:completed', 'C:completed', 'D:completed']), stageList(done));
        check(entry, 'D executed once', requestsFor('node:D') === 1, requestsFor('node:D'));
        for (const [stage, member] of [['A', 'Alpha'], ['B', 'Bravo'], ['C', 'Charlie'], ['D', 'Delta']]) {
          const saved = await replyFor(member, m => m.orchestrationRunId === done.id && m.orchestrationStageId === stage);
          check(entry, `reply of ${stage} stored in the message store`, saved?.content === `${stage} output`, saved?.content);
        }
        entry.screenshots.push(await shot(`bug2-${order.join('')}-completed`));
        requestLog.length = 0;
      });
    }

    // BUG #2 + #4: C's member is busy with a normal chat message, so C starts late; B finishing first must
    // not complete the run, and the normal reply must survive.
    await scenario('bug2-bug4-sibling-not-started-and-concurrent-chat', async entry => {
      await sendChat('Charlie', 'C1');
      await startFlow([node('B', 'Bravo'), node('C', 'Charlie'), node('D', 'Delta')], [['B', 'D'], ['C', 'D']], 'Late sibling');
      await waitFor(() => isHeld('node:B'), 'B request');
      await sleep(800);
      check(entry, 'C waits while Charlie answers normal chat', requestsFor('node:C') === 0, requestsFor('node:C'));
      const charlie = (await store()).rolesById[roleId('Charlie')];
      check(entry, 'Charlie still owns the normal chat prompt', charlie.status === 'thinking' && !(await store()).messagesById[charlie.lastPromptMessageId]?.orchestrationRunId, charlie.lastPromptMessageId);
      release('node:B', 'B output');
      await waitFor(async () => (await lastRun()).stageRuns.find(s => s.stageId === 'B')?.status === 'completed', 'B completed');
      await sleep(500);
      const mid = await lastRun();
      check(entry, 'run still running while C has not run', mid.status === 'running', stageList(mid));
      entry.screenshots.push(await shot('bug2-late-sibling-midway'));
      release('chat:C1', 'Normal answer C1');
      await waitFor(async () => (await replyFor('Charlie', m => m.content === 'Normal answer C1')), 'normal reply stored');
      check(entry, 'normal chat reply stored', true);
      await waitFor(() => isHeld('node:C'), 'C request after Charlie is free', 30000);
      release('node:C', 'C output');
      await waitFor(() => isHeld('node:D'), 'D request');
      release('node:D', 'D output');
      const done = await waitRunStatus('completed', 'run completed');
      check(entry, 'B, C, D completed', JSON.stringify(stageList(done).sort()) === JSON.stringify(['B:completed', 'C:completed', 'D:completed']), stageList(done));
      entry.screenshots.push(await shot('bug2-late-sibling-completed'));
      requestLog.length = 0;
    });

    // BUG #3: Fail-port node waits for the review.
    await scenario('bug3-fail-branch-after-review-fail', async entry => {
      await startFlow([node('W', 'Alpha'), node('R', 'Reviewer', 'review'), node('F', 'Fixer')], [['W', 'R'], ['R', 'F', 'fail']], 'Fail branch');
      await waitFor(() => isHeld('node:W'), 'W request');
      await sleep(800);
      check(entry, 'F not requested at start', requestsFor('node:F') === 0, requestsFor('node:F'));
      check(entry, 'only W started', JSON.stringify(stageList(await lastRun())) === JSON.stringify(['W:running']), stageList(await lastRun()));
      release('node:W', 'W output');
      await waitFor(() => isHeld('node:R'), 'R request');
      check(entry, 'F not requested before the review answers', requestsFor('node:F') === 0, requestsFor('node:F'));
      entry.screenshots.push(await shot('bug3-review-pending'));
      release('node:R', FAIL);
      await waitFor(() => isHeld('node:F'), 'F request after FAIL');
      release('node:F', 'F output');
      const done = await waitRunStatus('completed', 'run completed');
      check(entry, 'order W, R, F', JSON.stringify(done.stageRuns.map(s => s.stageId)) === JSON.stringify(['W', 'R', 'F']), stageList(done));
      check(entry, 'review recorded FAIL', done.stageRuns[1].reviewResults?.[0]?.decision === 'fail', done.stageRuns[1].reviewResults);
      entry.screenshots.push(await shot('bug3-completed'));
      requestLog.length = 0;
    });
    await scenario('bug3-fail-branch-skipped-on-pass', async entry => {
      await startFlow([node('W', 'Alpha'), node('R', 'Reviewer', 'review'), node('F', 'Fixer')], [['W', 'R'], ['R', 'F', 'fail']], 'Pass branch');
      await waitFor(() => isHeld('node:W'), 'W request');
      release('node:W', 'W output');
      await waitFor(() => isHeld('node:R'), 'R request');
      release('node:R', PASS);
      const done = await waitRunStatus('completed', 'run completed');
      check(entry, 'F never requested', requestsFor('node:F') === 0, requestsFor('node:F'));
      check(entry, 'order W, R', JSON.stringify(done.stageRuns.map(s => s.stageId)) === JSON.stringify(['W', 'R']), stageList(done));
      requestLog.length = 0;
    });

    // BUG #4: Stop workflow does not cancel a normal reply.
    await scenario('bug4-stop-keeps-normal-chat', async entry => {
      await startFlow([node('A', 'Alpha')], [], 'Stop me');
      await waitFor(() => isHeld('node:A'), 'A request');
      await sendChat('Delta', 'S1'); // a member used before, so the composer treats it as ready
      // The status card is localized; its Stop button is the danger action in the card header.
      const stopButton = page.locator('.orchestration-status-window-actions .btn-danger').first();
      if (!await stopButton.isVisible()) await page.locator('.orchestration-status-collapsed').first().click();
      await stopButton.click();
      const stopped = await waitRunStatus('stopped', 'run stopped');
      check(entry, 'run stopped from the status view', stopped.status === 'stopped', stopped.status);
      const s = await store();
      check(entry, 'Delta still thinking on its normal message', s.rolesById[roleId('Delta')].status === 'thinking', s.rolesById[roleId('Delta')].status);
      check(entry, 'Alpha (workflow member) stopped', s.rolesById[roleId('Alpha')].status === 'stopped', s.rolesById[roleId('Alpha')].status);
      entry.screenshots.push(await shot('bug4-after-stop'));
      release('chat:S1', 'Normal answer S1');
      await waitFor(async () => (await replyFor('Delta', m => m.content === 'Normal answer S1')), 'Delta reply stored');
      check(entry, 'normal reply stored after Stop', true);
      release('node:A', 'late A');
      await sleep(800);
      check(entry, 'late workflow reply did not revive the run', (await lastRun()).status === 'stopped', (await lastRun()).status);
      entry.screenshots.push(await shot('bug4-normal-reply-kept'));
      requestLog.length = 0;
    });

    // BUG #8: clear history while Running.
    await scenario('bug8-clear-history-while-running', async entry => {
      await startFlow([node('A', 'Alpha'), node('B', 'Bravo')], [['A', 'B']], 'Clear me');
      await waitFor(() => isHeld('node:A'), 'A request');
      entry.screenshots.push(await shot('bug8-before-clear'));
      const item = page.locator('.chat-item', { hasText: 'Workflow E2E' }).first();
      await item.hover().catch(() => {});
      await page.locator('.chat-menu-btn').first().click();
      await page.locator('.chat-action-menu button', { hasText: /^(Clear messages|Xóa tin nhắn)$/ }).click();
      await waitFor(async () => (await store()).chatsById[chatId].messageIds.length === 0, 'messages cleared');
      await sleep(500);
      const s = await store();
      const run = await lastRun();
      check(entry, 'run no longer running', run.status !== 'running' && run.status !== 'pending', run.status);
      check(entry, 'no active run for the chat', !s.activeOrchestrationRunIdByChatId[chatId], s.activeOrchestrationRunIdByChatId[chatId]);
      check(entry, 'chat status not running', s.chatsById[chatId].status !== 'running', s.chatsById[chatId].status);
      release('node:A', 'late A');
      await sleep(1000);
      check(entry, 'B never requested after clear', requestsFor('node:B') === 0, requestsFor('node:B'));
      check(entry, 'late reply did not refill the cleared chat with workflow messages', !Object.values((await store()).messagesById).some(m => m.chatId === chatId && m.orchestrationRunId === run.id), null);
      entry.screenshots.push(await shot('bug8-after-clear'));
    });
  } finally {
    await context.tracing.stop({ path: path.join(out, 'trace.zip') }).catch(() => {});
    await context.close().catch(() => {});
    server.close();
  }
  const summary = { kind: 'FIXTURE (fake OpenAI-compatible server, not a real provider)', at: new Date().toISOString(), results, consoleErrors };
  writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(out, 'summary.md'), [`# Workflow browser check (${summary.kind})`, '', ...results.map(r => `- **${r.status}** ${r.name}${r.error ? `\n  - ${r.error.split('\n')[0]}` : ''}\n${r.checks.map(c => `  - ${c.ok ? 'ok' : 'FAILED'}: ${c.label}`).join('\n')}`)].join('\n'));
  for (const r of results) console.log(`${r.status} ${r.name}${r.error ? ` — ${r.error.split('\n')[0]}` : ''}`);
  process.exit(results.every(r => r.status === 'PASS') ? 0 : 1);
}

main().catch(error => { console.error(error); process.exit(1); });
