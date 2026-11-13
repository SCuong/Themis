// Regression tests for workflow correctness (BUG #2 parallel completion, #3 fail branch at start,
// #4 normal chat vs workflow, #8 clearing history mid-run), driven through the real background.js
// router with a fake chrome (prompt-sync-harness.cjs). Replies are scripted, so race order is controlled.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { startThemis } = require('./prompt-sync-harness.cjs');

after(() => setImmediate(() => process.exit(0))); // background.js keeps keepalive timers alive

const ROLE_IDS = ['a', 'b', 'c', 'd', 'r', 'f'];
const roles = notReady => ROLE_IDS.map(id => ({ id, name: id.toUpperCase(), ...(notReady?.includes(id) ? { notReady: true } : {}) }));
const node = (id, roleId) => ({ id, kind: 'roles', name: id, roleIds: [roleId] });
const review = (id, roleId) => ({ id, kind: 'review', name: id, roleIds: [roleId], review: { reviewerRoleIds: [roleId], instructions: 'check', maxAttempts: 3 } });
const edge = (from, to, sourcePort) => ({ sourceStageId: from, targetStageId: to, ...(sourcePort ? { sourcePort } : {}) });
const PASS = JSON.stringify({ decision: 'pass', reason: 'ok', failedCriteria: [], nextRoundInstruction: '' });
const FAIL = JSON.stringify({ decision: 'fail', reason: 'bad', failedCriteria: ['x'], nextRoundInstruction: 'fix it' });

async function setup(stages, edges, { notReady } = {}) {
  const team = await startThemis({ mode: 'collaborative', roles: roles(notReady), seed(store) {
    store.orchestrationFlowsById.flow = { id: 'flow', chatId: 'chat', name: 'Flow', stages, graph: { stageNodes: stages, edges }, createdAt: 1, updatedAt: 1 };
    store.orchestrationFlowOrderByChatId.chat = ['flow'];
  } });
  return team;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, what, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(25);
  }
}
const promptsFor = (team, roleId) => team.prompts.filter(prompt => prompt.roleId === roleId);
const workflowPrompts = (team, roleId) => promptsFor(team, roleId).filter(prompt => prompt.messageId !== undefined && prompt.content.includes('TASK-'));
const nextPrompt = (team, roleId, index = 0) => waitFor(() => workflowPrompts(team, roleId)[index], `workflow prompt ${index} for ${roleId}`);
async function run(team) {
  const store = await team.store();
  const runId = store.activeOrchestrationRunIdByChatId.chat;
  return runId ? store.orchestrationRunsById[runId] : Object.values(store.orchestrationRunsById).at(-1);
}
// Starting a run waits for root deliveries (and for blocked frames), so it is not awaited here.
const start = team => { const pending = team.send({ type: 'GROUP_ORCHESTRATION_RUN', chatId: 'chat', flowId: 'flow', task: 'TASK-1' }); pending.catch(() => {}); return pending; };
// A reply can start the next stages and wait on them too, so it is fired and polled.
const reply = (team, roleId, prompt, content) => { team.send({ type: 'TEAM_ROLE_REPLY', chatId: 'chat', roleId, messageId: prompt.messageId, replyAttemptId: prompt.replyAttemptId, content }, roleId).catch(() => {}); };
const stageRunsOf = async (team, stageId) => (await run(team)).stageRuns.filter(stageRun => stageRun.stageId === stageId);
const stop = team => team.send({ type: 'GROUP_ORCHESTRATION_STOP', chatId: 'chat' });

// BUG #2 -------------------------------------------------------------------------------------------

for (const order of [['b', 'c'], ['c', 'b']]) {
  test(`BUG #2: parallel B and C finishing ${order.join(' then ')} run the join D once, then complete`, async () => {
    const team = await setup([node('A', 'a'), node('B', 'b'), node('C', 'c'), node('D', 'd')], [edge('A', 'B'), edge('A', 'C'), edge('B', 'D'), edge('C', 'D')]);
    start(team);
    reply(team, 'a', await nextPrompt(team, 'a'), 'A done');
    const prompts = { b: await nextPrompt(team, 'b'), c: await nextPrompt(team, 'c') };
    reply(team, order[0], prompts[order[0]], `${order[0]} done`);
    await waitFor(async () => (await stageRunsOf(team, order[0].toUpperCase()))[0]?.status === 'completed', 'first branch completed');
    assert.equal((await run(team)).status, 'running');
    assert.equal(workflowPrompts(team, 'd').length, 0, 'D must wait for both branches');
    reply(team, order[1], prompts[order[1]], `${order[1]} done`);
    reply(team, 'd', await nextPrompt(team, 'd'), 'D done');
    await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
    const finished = await run(team);
    assert.deepEqual(finished.stageRuns.map(stageRun => [stageRun.stageId, stageRun.status]).sort(), [['A', 'completed'], ['B', 'completed'], ['C', 'completed'], ['D', 'completed']]);
    assert.equal(workflowPrompts(team, 'd').length, 1, 'D ran exactly once');
  });
}

test('BUG #2: a branch that finishes before its sibling has started does not complete the run', async () => {
  // C's frame is not ready, so C is still waiting to start while B already replies.
  const team = await setup([node('B', 'b'), node('C', 'c'), node('D', 'd')], [edge('B', 'D'), edge('C', 'D')], { notReady: ['c'] });
  start(team);
  reply(team, 'b', await nextPrompt(team, 'b'), 'B done');
  await waitFor(async () => (await stageRunsOf(team, 'B'))[0]?.status === 'completed', 'B completed');
  await sleep(200);
  const midway = await run(team);
  assert.equal(midway.status, 'running', 'run must not report Completed while C has not run');
  assert.equal(workflowPrompts(team, 'c').length, 0);
  await team.frameReady('c');
  reply(team, 'c', await nextPrompt(team, 'c'), 'C done');
  reply(team, 'd', await nextPrompt(team, 'd'), 'D done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.deepEqual((await run(team)).stageRuns.map(stageRun => stageRun.stageId).sort(), ['B', 'C', 'D']);
});

test('BUG #2: two independent branches without a join both run before Completed', async () => {
  const team = await setup([node('B', 'b'), node('C', 'c')], [], { notReady: ['c'] });
  start(team);
  reply(team, 'b', await nextPrompt(team, 'b'), 'B done');
  await waitFor(async () => (await stageRunsOf(team, 'B'))[0]?.status === 'completed', 'B completed');
  await sleep(200);
  assert.equal((await run(team)).status, 'running');
  await team.frameReady('c');
  reply(team, 'c', await nextPrompt(team, 'c'), 'C done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #2: retrying a failed node also restarts a parallel node that was still waiting to start', async () => {
  const team = await setup([review('R', 'r'), node('C', 'c'), node('D', 'd')], [edge('R', 'D', 'pass'), edge('C', 'D')], { notReady: ['c'] });
  start(team);
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json'); // invalid review -> run error
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await sleep(2500); // C's start loop sees the error and gives up, leaving C reserved
  team.send({ type: 'GROUP_ORCHESTRATION_RETRY_REVIEW', chatId: 'chat' }).catch(() => {});
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  await team.frameReady('c');
  reply(team, 'c', await nextPrompt(team, 'c'), 'C done');
  reply(team, 'd', await nextPrompt(team, 'd'), 'D done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.equal(workflowPrompts(team, 'c').length, 1, 'C started exactly once');
});

// BUG #3 -------------------------------------------------------------------------------------------

const failBranchFlow = () => [[node('W', 'a'), review('R', 'r'), node('F', 'f')], [edge('W', 'R'), edge('R', 'F', 'fail')]];

test('BUG #3: a node reached only from the Fail port does not run at start, and runs after FAIL', async () => {
  const team = await setup(...failBranchFlow());
  start(team);
  reply(team, 'a', await nextPrompt(team, 'a'), 'W done');
  const reviewPrompt = await nextPrompt(team, 'r');
  assert.equal(workflowPrompts(team, 'f').length, 0, 'F must not run before the review');
  assert.deepEqual((await run(team)).stageRuns.map(stageRun => stageRun.stageId), ['W', 'R']);
  reply(team, 'r', reviewPrompt, FAIL);
  reply(team, 'f', await nextPrompt(team, 'f'), 'F done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.deepEqual((await run(team)).stageRuns.map(stageRun => stageRun.stageId), ['W', 'R', 'F']);
});

test('BUG #3: the Fail branch never runs when the review passes', async () => {
  const team = await setup(...failBranchFlow());
  start(team);
  reply(team, 'a', await nextPrompt(team, 'a'), 'W done');
  reply(team, 'r', await nextPrompt(team, 'r'), PASS);
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.equal(workflowPrompts(team, 'f').length, 0);
});

test('BUG #3: a fixer on the Fail port that loops back into the review waits for FAIL', async () => {
  const team = await setup([node('W', 'a'), review('R', 'r'), node('F', 'f')], [edge('W', 'R'), edge('R', 'F', 'fail'), edge('F', 'R')]);
  start(team);
  reply(team, 'a', await nextPrompt(team, 'a'), 'W done');
  reply(team, 'r', await nextPrompt(team, 'r'), FAIL);
  assert.equal(workflowPrompts(team, 'f').length <= 1, true);
  reply(team, 'f', await nextPrompt(team, 'f'), 'F done');
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.deepEqual((await run(team)).stageRuns.map(stageRun => stageRun.stageId), ['W', 'R', 'F', 'R']);
});

test('BUG #3: a revise loop whose head is entered only by Fail still starts there', async () => {
  // Built-in "product -> engineering -> review; back to product on fail" shape.
  const team = await setup([node('P', 'a'), node('E', 'b'), review('R', 'r')], [edge('P', 'E'), edge('E', 'R'), edge('R', 'P', 'fail')]);
  start(team);
  reply(team, 'a', await nextPrompt(team, 'a'), 'P done');
  reply(team, 'b', await nextPrompt(team, 'b'), 'E done');
  reply(team, 'r', await nextPrompt(team, 'r'), FAIL);
  reply(team, 'a', await nextPrompt(team, 'a', 1), 'P2 done');
  reply(team, 'b', await nextPrompt(team, 'b', 1), 'E2 done');
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

// BUG #4 -------------------------------------------------------------------------------------------

const assistantReplyTo = async (team, roleId, messageId) => Object.values((await team.store()).messagesById).find(message => message.type === 'assistant' && message.roleId === roleId && message.sourceMessageId === messageId);

test('BUG #4: starting a workflow while a member answers normal chat keeps that reply, then runs the node', async () => {
  const team = await setup([node('B', 'b')], []);
  const chat = await team.user('@B normal question');
  const chatPrompt = chat.byRole.b;
  assert.ok(chatPrompt, 'normal prompt delivered');
  start(team);
  await sleep(300);
  assert.equal(workflowPrompts(team, 'b').length, 0, 'workflow must wait while B is busy');
  assert.equal((await team.role('b')).lastPromptMessageId, chat.messageId);
  await team.ack('b', chat.messageId);
  await team.reply('b', chatPrompt, 'normal answer');
  const saved = await assistantReplyTo(team, 'b', chat.messageId);
  assert.equal(saved?.content, 'normal answer', 'normal chat reply must be stored');
  reply(team, 'b', await nextPrompt(team, 'b'), 'B workflow done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #4: Stop workflow leaves a normal-chat reply of another member alone', async () => {
  const team = await setup([node('A', 'a')], []);
  start(team);
  await nextPrompt(team, 'a');
  const chat = await team.user('@C side question');
  await stop(team);
  const c = await team.role('c');
  assert.equal(c.status, 'thinking', 'C is not part of the workflow');
  assert.equal(c.lastPromptMessageId, chat.messageId);
  assert.equal((await team.role('a')).status, 'stopped');
  await team.ack('c', chat.messageId);
  await team.reply('c', chat.byRole.c, 'side answer');
  assert.equal((await assistantReplyTo(team, 'c', chat.messageId))?.content, 'side answer');
});

// Findings of the Codex audit (each reproduced the earlier version of this fix) --------------------

test('BUG #2 (audit): a join behind a Fail fan-out waits for both branches and runs once', async () => {
  const team = await setup([node('W', 'a'), review('R', 'r'), node('F', 'f'), node('G', 'b'), node('J', 'd')],
    [edge('W', 'R'), edge('R', 'F', 'fail'), edge('R', 'G', 'fail'), edge('F', 'J'), edge('G', 'J')]);
  start(team);
  reply(team, 'a', await nextPrompt(team, 'a'), 'W done');
  reply(team, 'r', await nextPrompt(team, 'r'), FAIL);
  const f = await nextPrompt(team, 'f');
  const g = await nextPrompt(team, 'b');
  reply(team, 'f', f, 'F done');
  await waitFor(async () => (await stageRunsOf(team, 'F'))[0]?.status === 'completed', 'F completed');
  await sleep(200);
  assert.equal(workflowPrompts(team, 'd').length, 0, 'J waits for G');
  reply(team, 'b', g, 'G done');
  reply(team, 'd', await nextPrompt(team, 'd'), 'J done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.equal(workflowPrompts(team, 'd').length, 1);
});

test('BUG #2 (audit): a review Pass output waits for the other source of its join', async () => {
  const team = await setup([node('B', 'b'), review('R', 'r'), node('D', 'd')], [edge('B', 'D'), edge('R', 'D', 'pass')]);
  start(team);
  const b = await nextPrompt(team, 'b');
  reply(team, 'r', await nextPrompt(team, 'r'), PASS);
  await waitFor(async () => (await stageRunsOf(team, 'R'))[0]?.status === 'completed', 'R completed');
  await sleep(200);
  assert.equal(workflowPrompts(team, 'd').length, 0, 'D waits for B');
  reply(team, 'b', b, 'B done');
  reply(team, 'd', await nextPrompt(team, 'd'), 'D done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #2 (audit): a loop join ignores completions from the previous iteration', async () => {
  const team = await setup([node('B', 'b'), node('C', 'c'), review('R', 'r')], [edge('B', 'R'), edge('C', 'R'), edge('R', 'B', 'fail'), edge('R', 'C', 'fail')]);
  start(team);
  reply(team, 'b', await nextPrompt(team, 'b'), 'B1');
  reply(team, 'c', await nextPrompt(team, 'c'), 'C1');
  reply(team, 'r', await nextPrompt(team, 'r'), FAIL);
  const c2 = await nextPrompt(team, 'c', 1);
  reply(team, 'b', await nextPrompt(team, 'b', 1), 'B2');
  await waitFor(async () => (await stageRunsOf(team, 'B'))[1]?.status === 'completed', 'B2 completed');
  await sleep(200);
  assert.equal(workflowPrompts(team, 'r').length, 1, 'R waits for C2');
  reply(team, 'c', c2, 'C2');
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #3 (audit): parallel heads of a closed revise loop both start', async () => {
  const team = await setup([node('B', 'b'), node('C', 'c'), review('R', 'r')], [edge('B', 'R'), edge('C', 'R'), edge('R', 'B', 'fail'), edge('R', 'C', 'fail')]);
  start(team);
  await nextPrompt(team, 'b');
  await nextPrompt(team, 'c');
  assert.deepEqual((await run(team)).stageRuns.map(stageRun => stageRun.stageId).sort(), ['B', 'C']);
  await stop(team);
});

test('BUG #2 (audit): retrying a failed review keeps a running sibling and its join', async () => {
  const team = await setup([review('R', 'r'), node('A', 'a'), node('C', 'c'), node('D', 'd')], [edge('R', 'A', 'pass'), edge('A', 'D'), edge('C', 'D')]);
  start(team);
  const c = await nextPrompt(team, 'c');
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  team.send({ type: 'GROUP_ORCHESTRATION_RETRY_REVIEW', chatId: 'chat' }).catch(() => {});
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  reply(team, 'a', await nextPrompt(team, 'a'), 'A done');
  await waitFor(async () => (await stageRunsOf(team, 'A'))[0]?.status === 'completed', 'A completed');
  await sleep(200);
  assert.equal((await run(team)).status, 'running', 'C is still running');
  assert.equal((await stageRunsOf(team, 'C'))[0]?.status, 'running', 'C record kept');
  reply(team, 'c', c, 'C done');
  reply(team, 'd', await nextPrompt(team, 'd'), 'D done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #2 (audit): Resume runs every parallel node that Stop interrupted', async () => {
  const team = await setup([node('B', 'b'), node('C', 'c'), node('D', 'd')], [edge('B', 'D'), edge('C', 'D')]);
  start(team);
  await nextPrompt(team, 'b');
  await nextPrompt(team, 'c');
  await stop(team);
  team.send({ type: 'GROUP_ORCHESTRATION_RESUME', chatId: 'chat' }).catch(() => {});
  reply(team, 'b', await nextPrompt(team, 'b', 1), 'B done');
  reply(team, 'c', await nextPrompt(team, 'c', 1), 'C done');
  reply(team, 'd', await nextPrompt(team, 'd'), 'D done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #2 (audit): a node reserved when the service worker died starts after a restart', async () => {
  // The store as a dead worker leaves it: active run, node A reserved (pending) but never started.
  const stages = [node('A', 'a')];
  const team = await startThemis({ mode: 'collaborative', roles: roles(), seed(store) {
    store.orchestrationFlowsById.flow = { id: 'flow', chatId: 'chat', name: 'Flow', stages, graph: { stageNodes: stages, edges: [] }, createdAt: 1, updatedAt: 1 };
    store.orchestrationRunsById.left = { id: 'left', chatId: 'chat', flowId: 'flow', status: 'running', currentRound: 1, maxNodeExecutions: 20, maxRounds: 20, createdAt: 1, updatedAt: 1,
      stageRuns: [{ stageId: 'A', stageIndex: 0, kind: 'roles', round: 1, status: 'pending', roleRuns: {}, startedAt: 1 }] };
    store.activeOrchestrationRunIdByChatId.chat = 'left';
    store.messagesById.task = { id: 'task', chatId: 'chat', seq: 1, type: 'user', content: 'TASK-1', targetRoleIds: [], orchestrationRunId: 'left', orchestrationKind: 'task', createdAt: 1, status: 'received' };
    store.chatsById.chat.messageIds.push('task');
    store.chatsById.chat.nextMessageSeq = 2;
  } });
  reply(team, 'a', await nextPrompt(team, 'a'), 'A done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #4 (audit): a slow normal reply (silent > 2 minutes) is not taken over by the workflow', async () => {
  const team = await setup([node('B', 'b')], []);
  const chat = await team.user('@B slow question');
  // Make B look silent for 10 minutes, as a long-thinking model does.
  const memory = team.memory;
  const storeKey = Object.keys(memory).find(key => memory[key]?.rolesById);
  memory[storeKey].rolesById.b.updatedAt = Date.now() - 10 * 60 * 1000;
  start(team);
  await sleep(400);
  assert.equal(workflowPrompts(team, 'b').length, 0, 'workflow waits for B');
  await team.ack('b', chat.messageId);
  await team.reply('b', chat.byRole.b, 'slow answer');
  assert.equal((await assistantReplyTo(team, 'b', chat.messageId))?.content, 'slow answer');
  reply(team, 'b', await nextPrompt(team, 'b'), 'B workflow done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #4 (audit): Stop frees the DeepSeek delivery slots for later normal messages', async () => {
  const team = await startThemis({ mode: 'collaborative', roles: ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), chatSite: 'deepseek' })), seed(store) {
    const stages = [node('A', 'a'), node('B', 'b')];
    store.orchestrationFlowsById.flow = { id: 'flow', chatId: 'chat', name: 'Flow', stages, graph: { stageNodes: stages, edges: [] }, createdAt: 1, updatedAt: 1 };
  } });
  start(team);
  await nextPrompt(team, 'a');
  await nextPrompt(team, 'b');
  await stop(team);
  const chat = await team.user('@C after stop');
  assert.ok(chat.byRole.c, 'normal message to C is delivered, not queued behind stopped prompts');
});

test('BUG #2 (audit 2): a join behind Fail paths of unequal length runs once, after both', async () => {
  const team = await setup([node('W', 'a'), review('R', 'r'), node('F', 'f'), node('G', 'b'), node('H', 'c'), node('J', 'd')],
    [edge('W', 'R'), edge('R', 'F', 'fail'), edge('R', 'G', 'fail'), edge('F', 'J'), edge('G', 'H'), edge('H', 'J')]);
  start(team);
  reply(team, 'a', await nextPrompt(team, 'a'), 'W done');
  reply(team, 'r', await nextPrompt(team, 'r'), FAIL);
  const g = await nextPrompt(team, 'b');
  reply(team, 'f', await nextPrompt(team, 'f'), 'F done');
  await waitFor(async () => (await stageRunsOf(team, 'F'))[0]?.status === 'completed', 'F completed');
  await sleep(200);
  assert.equal(workflowPrompts(team, 'd').length, 0, 'J waits for the G -> H path');
  reply(team, 'b', g, 'G done');
  const h = await nextPrompt(team, 'c');
  await sleep(200);
  assert.equal(workflowPrompts(team, 'd').length, 0, 'J waits for H, which G just started');
  reply(team, 'c', h, 'H done');
  reply(team, 'd', await nextPrompt(team, 'd'), 'J done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.equal(workflowPrompts(team, 'd').length, 1, 'J ran once');
});

test('BUG #3 (audit 2): a Pass target does not run after the review FAILED', async () => {
  const team = await setup([node('B', 'b'), review('R', 'r'), node('D', 'd'), node('F', 'f')], [edge('B', 'D'), edge('R', 'D', 'pass'), edge('R', 'F', 'fail')]);
  start(team);
  const b = await nextPrompt(team, 'b');
  reply(team, 'r', await nextPrompt(team, 'r'), FAIL);
  reply(team, 'f', await nextPrompt(team, 'f'), 'F done');
  reply(team, 'b', b, 'B done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.equal(workflowPrompts(team, 'd').length, 0, 'D needs R to pass');
});

test('BUG #2 (audit 2): a sibling that replies while the run is in error counts after Retry', async () => {
  const team = await setup([review('R', 'r'), node('C', 'c'), node('D', 'd')], [edge('R', 'D', 'pass'), edge('C', 'D')]);
  start(team);
  const c = await nextPrompt(team, 'c');
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await team.reply('c', c, 'C done during error');
  assert.equal((await stageRunsOf(team, 'C'))[0]?.status, 'completed', 'C recorded as finished');
  team.send({ type: 'GROUP_ORCHESTRATION_RETRY_REVIEW', chatId: 'chat' }).catch(() => {});
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  reply(team, 'd', await nextPrompt(team, 'd'), 'D done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #8 (audit 2): clearing history frees the DeepSeek delivery slots', async () => {
  const team = await startThemis({ mode: 'collaborative', roles: ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), chatSite: 'deepseek' })), seed(store) {
    const stages = [node('A', 'a'), node('B', 'b')];
    store.orchestrationFlowsById.flow = { id: 'flow', chatId: 'chat', name: 'Flow', stages, graph: { stageNodes: stages, edges: [] }, createdAt: 1, updatedAt: 1 };
  } });
  start(team);
  await nextPrompt(team, 'a');
  await nextPrompt(team, 'b');
  await team.send({ type: 'GROUP_CHAT_CLEAR_MESSAGES', chatId: 'chat' });
  await team.frameReady('c');
  const chat = await team.user('@C after clear');
  assert.ok(chat.byRole.c, 'normal message to C is delivered after clearing');
});

test('BUG #2 (audit 3): retrying one failed review does not complete the run while another stays failed', async () => {
  const team = await setup([review('R', 'r'), review('S', 'b'), node('D', 'd')], [edge('R', 'D', 'pass'), edge('S', 'D', 'pass')]);
  start(team);
  const s = await nextPrompt(team, 'b');
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await team.reply('b', s, 'also not json');
  team.send({ type: 'GROUP_ORCHESTRATION_RETRY_REVIEW', chatId: 'chat' }).catch(() => {});
  const retried = await waitFor(() => workflowPrompts(team, 'r')[1] ?? workflowPrompts(team, 'b')[1], 'a retried review prompt');
  reply(team, retried.roleId, retried, PASS);
  await waitFor(async () => (await run(team)).status !== 'running', 'run settles');
  await sleep(200);
  const settled = await run(team);
  assert.equal(settled.status, 'error', 'the other failed review still needs a retry');
  assert.equal(workflowPrompts(team, 'd').length, 0);
});

test('BUG #3 (audit 3): a FAIL that arrives while the run is in error still opens its Fail branch after Retry', async () => {
  const team = await setup([review('R', 'r'), review('S', 'b'), node('F', 'f')], [edge('S', 'F', 'fail')]);
  start(team);
  const s = await nextPrompt(team, 'b');
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await team.reply('b', s, FAIL);
  team.send({ type: 'GROUP_ORCHESTRATION_RETRY_STAGE', chatId: 'chat', stageId: 'R' }).catch(() => {});
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  reply(team, 'f', await nextPrompt(team, 'f'), 'F done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #3 (audit 3): an unlabelled edge out of a review follows Pass, so FAIL does not take it', async () => {
  const team = await setup([review('R', 'r'), node('D', 'd'), node('F', 'f')], [edge('R', 'D'), edge('R', 'F', 'fail')]);
  start(team);
  reply(team, 'r', await nextPrompt(team, 'r'), FAIL);
  reply(team, 'f', await nextPrompt(team, 'f'), 'F done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.equal(workflowPrompts(team, 'd').length, 0);
});

const reviewOnce = (id, roleId) => ({ ...review(id, roleId), review: { reviewerRoleIds: [roleId], instructions: 'check', maxAttempts: 1, onMaxAttempts: 'stop' } });

test('BUG #2 (audit 4): a Fail target opened after Retry runs before its join, and the join runs once', async () => {
  const team = await setup([review('R', 'r'), review('S', 'b'), node('F', 'f'), node('C', 'c'), node('D', 'd')], [edge('S', 'F', 'fail'), edge('F', 'D'), edge('C', 'D')]);
  start(team);
  const sPrompt = await nextPrompt(team, 'b');
  const cPrompt = await nextPrompt(team, 'c');
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await team.reply('b', sPrompt, FAIL);
  await team.reply('c', cPrompt, 'C done');
  team.send({ type: 'GROUP_ORCHESTRATION_RETRY_STAGE', chatId: 'chat', stageId: 'R' }).catch(() => {});
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  const f = await nextPrompt(team, 'f');
  await sleep(200);
  assert.equal(workflowPrompts(team, 'd').length, 0, 'D waits for F');
  reply(team, 'f', f, 'F done');
  reply(team, 'd', await nextPrompt(team, 'd'), 'D done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.equal(workflowPrompts(team, 'd').length, 1);
});

test('BUG #3 (audit 4): a FAIL recorded during error still obeys "stop at the last attempt"', async () => {
  const team = await setup([review('R', 'r'), reviewOnce('S', 'b'), node('F', 'f')], [edge('S', 'F', 'fail')]);
  start(team);
  const sPrompt = await nextPrompt(team, 'b');
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await team.reply('b', sPrompt, FAIL);
  const store = await team.store();
  assert.equal(store.activeOrchestrationRunIdByChatId.chat, undefined, 'run ended by the stop policy');
  assert.match(Object.values(store.orchestrationRunsById)[0].error, /maximum review attempts/);
  await sleep(200);
  assert.equal(workflowPrompts(team, 'f').length, 0);
});

test('BUG #2 (audit 4): an error superseded by a later run of the same node does not block completion', async () => {
  const team = await setup([node('W', 'a'), node('A', 'b'), review('S', 'r')], [edge('W', 'A'), edge('S', 'A', 'fail')]);
  start(team);
  const sPrompt = await nextPrompt(team, 'r');
  reply(team, 'a', await nextPrompt(team, 'a'), 'W done');
  const aPrompt = await nextPrompt(team, 'b');
  await team.send({ type: 'TEAM_ROLE_ERROR', chatId: 'chat', roleId: 'b', messageId: aPrompt.messageId, replyAttemptId: aPrompt.replyAttemptId, error: 'unauthorized' }, 'b');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await team.reply('r', sPrompt, 'not json');
  team.send({ type: 'GROUP_ORCHESTRATION_RETRY_STAGE', chatId: 'chat', stageId: 'S' }).catch(() => {});
  reply(team, 'r', await nextPrompt(team, 'r', 1), FAIL);
  reply(team, 'b', await nextPrompt(team, 'b', 1), 'A done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #2 (audit 5): with the join listed before its Fail-branch source, the source still runs first', async () => {
  // Stage order [R, S, D, C, F]: D comes before F in the flow, as in the audit repro.
  const team = await setup([review('R', 'r'), review('S', 'b'), node('D', 'd'), node('C', 'c'), node('F', 'f')], [edge('S', 'F', 'fail'), edge('F', 'D'), edge('C', 'D')]);
  start(team);
  const sPrompt = await nextPrompt(team, 'b');
  const cPrompt = await nextPrompt(team, 'c');
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await team.reply('b', sPrompt, FAIL);
  await team.reply('c', cPrompt, 'C done');
  team.send({ type: 'GROUP_ORCHESTRATION_RETRY_STAGE', chatId: 'chat', stageId: 'R' }).catch(() => {});
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  const f = await nextPrompt(team, 'f');
  await sleep(200);
  assert.equal(workflowPrompts(team, 'd').length, 0, 'D waits for F');
  reply(team, 'f', f, 'F done');
  reply(team, 'd', await nextPrompt(team, 'd'), 'D done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
  assert.equal(workflowPrompts(team, 'd').length, 1);
});

test('BUG #4 (audit 5): a run ended by "stop at the last attempt" releases its parallel nodes and DeepSeek slots', async () => {
  const team = await startThemis({ mode: 'collaborative', roles: ['a', 'c', 'e', 'r', 's'].map(id => ({ id, name: id.toUpperCase(), chatSite: id === 'r' || id === 's' ? 'gemini' : 'deepseek' })), seed(store) {
    const stages = [review('R', 'r'), reviewOnce('S', 's'), node('A', 'a'), node('C', 'c')];
    store.orchestrationFlowsById.flow = { id: 'flow', chatId: 'chat', name: 'Flow', stages, graph: { stageNodes: stages, edges: [] }, createdAt: 1, updatedAt: 1 };
  } });
  start(team);
  await nextPrompt(team, 'a');
  await nextPrompt(team, 'c');
  const sPrompt = await nextPrompt(team, 's');
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await team.reply('s', sPrompt, FAIL);
  const store = await team.store();
  assert.equal(store.activeOrchestrationRunIdByChatId.chat, undefined);
  for (const roleId of ['a', 'c']) assert.notEqual(store.rolesById[roleId].status, 'thinking', `${roleId} released`);
  assert.ok(!Object.values(store.orchestrationRunsById)[0].stageRuns.some(stageRun => stageRun.status === 'running'), 'no node left running');
  const chat = await team.user('@E after the run ended');
  assert.ok(chat.byRole.e, 'normal DeepSeek message is delivered');
});

const deepseekTeam = (stages, extraRoles = []) => startThemis({ mode: 'collaborative', roles: [...['a', 'b', 'c', ...extraRoles].map(id => ({ id, name: id.toUpperCase(), chatSite: 'deepseek' })), { id: 'r', name: 'R', chatSite: 'gemini' }], seed(store) {
  store.orchestrationFlowsById.flow = { id: 'flow', chatId: 'chat', name: 'Flow', stages, graph: { stageNodes: stages, edges: [] }, createdAt: 1, updatedAt: 1 };
} });

test('BUG #2 (audit 6): a node queued behind the DeepSeek limit still runs when another node errors and is retried', async () => {
  const team = await deepseekTeam([review('R', 'r'), node('A', 'a'), node('B', 'b'), node('C', 'c')]);
  start(team);
  const a = await nextPrompt(team, 'a');
  const b = await nextPrompt(team, 'b');
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await sleep(200);
  assert.equal(workflowPrompts(team, 'c').length, 0, 'C still waits for a DeepSeek slot');
  await team.reply('a', a, 'A done');
  const c = await nextPrompt(team, 'c');
  team.send({ type: 'GROUP_ORCHESTRATION_RETRY_REVIEW', chatId: 'chat' }).catch(() => {});
  reply(team, 'r', await nextPrompt(team, 'r', 1), PASS);
  reply(team, 'b', b, 'B done');
  reply(team, 'c', c, 'C done');
  await waitFor(async () => (await run(team)).status === 'completed', 'run completed');
});

test('BUG #4 (audit 6): a recoverable workflow error keeps its DeepSeek slots, so a queued normal message waits its turn', async () => {
  const team = await deepseekTeam([review('R', 'r'), node('A', 'a'), node('B', 'b')], ['e']);
  start(team);
  await nextPrompt(team, 'a');
  await nextPrompt(team, 'b');
  const pendingChat = team.user('@E queued question');
  pendingChat.catch(() => {});
  reply(team, 'r', await nextPrompt(team, 'r'), 'not json');
  await waitFor(async () => (await run(team)).status === 'error', 'run error');
  await sleep(300);
  assert.equal(promptsFor(team, 'e').length, 0, 'at most two DeepSeek prompts at a time');
  await stop(team);
  await waitFor(() => promptsFor(team, 'e').length === 1, 'E delivered after Stop frees the slots');
});

// BUG #8 -------------------------------------------------------------------------------------------

test('BUG #8 (audit): Continue after clearing history refuses instead of reviving a Running run', async () => {
  const team = await setup([node('A', 'a')], []);
  start(team);
  await nextPrompt(team, 'a');
  await team.send({ type: 'GROUP_CHAT_CLEAR_MESSAGES', chatId: 'chat' });
  const resumed = await team.send({ type: 'GROUP_ORCHESTRATION_RESUME', chatId: 'chat' });
  assert.equal(resumed.ok, false);
  const store = await team.store();
  assert.equal(store.activeOrchestrationRunIdByChatId.chat, undefined);
  assert.equal(Object.values(store.orchestrationRunsById)[0].status, 'stopped');
});

test('BUG #8: clearing chat history while a workflow runs ends the run instead of leaving it Running', async () => {
  const team = await setup([node('A', 'a'), node('B', 'b')], [edge('A', 'B')]);
  start(team);
  const prompt = await nextPrompt(team, 'a');
  const cleared = await team.send({ type: 'GROUP_CHAT_CLEAR_MESSAGES', chatId: 'chat' });
  assert.notEqual(cleared.ok, false, cleared.error);
  const store = await team.store();
  assert.equal(store.activeOrchestrationRunIdByChatId.chat, undefined);
  const stale = Object.values(store.orchestrationRunsById)[0];
  assert.notEqual(stale.status, 'running');
  assert.notEqual(stale.status, 'pending');
  assert.notEqual(store.chatsById.chat.status, 'running');
  // A late reply to the cleared prompt must not revive the run or start B.
  await team.frameReady('a');
  reply(team, 'a', prompt, 'late');
  await sleep(300);
  assert.equal(workflowPrompts(team, 'b').length, 0);
  assert.equal((await team.store()).chatsById.chat.messageIds.length, 0);
});
