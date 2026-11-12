// Regression tests for persona/member delivery and context sync, driven through the real
// background.js message router (see prompt-sync-harness.cjs).
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { startThemis } = require('./prompt-sync-harness.cjs');

after(() => setImmediate(() => process.exit(0))); // background.js keeps keepalive timers alive

const PERSONA_A = 'Persona A: luôn phản biện rủi ro kỹ thuật.';
const PERSONA_B = 'Persona B: luôn bảo vệ người dùng cuối.';
const roles = () => [
  { id: 'a', name: 'Kỹ sư', description: 'Đánh giá kỹ thuật', systemPrompt: PERSONA_A },
  { id: 'b', name: 'Sản phẩm', description: 'Bảo vệ người dùng', systemPrompt: PERSONA_B },
];
const MEMBERS = 'Thành viên trong nhóm';

for (const mode of ['independent', 'collaborative']) {
  test(`${mode}: persona and members go out once, later turns stay short and keep identity`, async () => {
    const team = await startThemis({ mode, roles: roles() });
    const first = await team.turn('Hello 1');
    assert.match(first.byRole.a.content, /Persona A/);
    assert.equal(first.byRole.a.includesPersona, true);
    assert.equal(first.byRole.a.content.includes(MEMBERS), mode === 'collaborative');

    for (const text of ['Hello 2', 'Hello 3']) {
      const sent = await team.turn(text);
      for (const roleId of ['a', 'b']) {
        const prompt = sent.byRole[roleId];
        assert.equal(prompt.includesPersona, false, `${text} ${roleId}`);
        assert.doesNotMatch(prompt.content, /Persona [AB]|Thành viên trong nhóm|Trách nhiệm của bạn/);
        assert.match(prompt.content, new RegExp(`"${roles().find(role => role.id === roleId).name}"`));
        assert.match(prompt.content, new RegExp(text));
      }
    }
  });

  test(`${mode}: reload into the same conversation keeps the sync, a blank reload restores it`, async () => {
    const team = await startThemis({ mode, roles: roles() });
    await team.turn('Hello 1', roleId => `Answer 1 from ${roleId}`);
    await team.frameReady('a', 'c-a'); // reload, provider reopened the stored chat
    const same = await team.turn('Hello 2', roleId => `Answer 2 from ${roleId}`);
    assert.equal(same.byRole.a.includesPersona, false);

    await team.frameReady('a'); // reload landed on a blank chat: context is gone
    const restored = (await team.user('Hello 3')).byRole;
    assert.equal(restored.a.includesPersona, true);
    assert.match(restored.a.content, /Persona A/);
    // The new chat must get the earlier exchange back, including a's own answers.
    for (const line of ['Hello 1', 'Answer 1 from a', 'Hello 2', 'Answer 2 from a']) assert.ok(restored.a.content.includes(line), line);
    assert.equal(restored.a.content.includes('Answer 2 from b'), mode === 'collaborative');
    // b was not reloaded: no persona, no replay.
    assert.equal(restored.b.includesPersona, false);
    assert.doesNotMatch(restored.b.content, /Hello 1|Answer 1/);
  });
}

test('collaborative: each other-member reply is synced exactly once', async () => {
  const team = await startThemis({ mode: 'collaborative', roles: roles() });
  await team.turn('Hello 1', roleId => `R1-${roleId}`);
  const second = await team.turn('Hello 2', roleId => `R2-${roleId}`);
  assert.match(second.byRole.a.content, /R1-b/);
  assert.doesNotMatch(second.byRole.a.content, /R1-a/);
  const third = await team.user('Hello 3');
  assert.match(third.byRole.a.content, /R2-b/);
  assert.doesNotMatch(third.byRole.a.content, /R1-b|R1-a|R2-a/);
});

test('switching the provider conversation or editing the role re-sends the persona', async () => {
  const team = await startThemis({ mode: 'collaborative', roles: roles() });
  await team.turn('Hello 1');
  await team.conversationUpdated('a', 'other-chat'); // user opened another chat inside the iframe
  const switched = await team.turn('Hello 2');
  assert.equal(switched.byRole.a.includesPersona, true);
  assert.equal(switched.byRole.b.includesPersona, false);

  await team.send({ type: 'GROUP_ROLE_UPDATE', roleId: 'b', patch: { description: 'Trách nhiệm mới' } });
  const edited = (await team.turn('Hello 3')).byRole;
  // The member list changed for everyone; only the conversation itself is intact.
  assert.match(edited.a.content, /Trách nhiệm mới/);
  assert.match(edited.b.content, /Persona B/);
  assert.doesNotMatch(edited.b.content, /Hello 1/);
});

test('a prompt that never reached the provider is not treated as delivered', async () => {
  const team = await startThemis({ mode: 'independent', roles: roles() });
  const lost = await team.user('Hello 1'); // sent, but no TEAM_SEND_ACK and no reply
  await team.send({ type: 'GROUP_ROLE_STOP_REPLY', chatId: 'chat', roleId: 'a' });
  await team.send({ type: 'GROUP_ROLE_STOP_REPLY', chatId: 'chat', roleId: 'b' });
  const next = (await team.user('Hello 2')).byRole;
  assert.equal(next.a.includesPersona, true);
  assert.match(next.a.content, /Persona A/);
  assert.ok(lost.byRole.a);
});

test('retrying a delivered message does not resend the persona; retrying an undelivered one does', async () => {
  const team = await startThemis({ mode: 'independent', roles: roles() });
  const first = await team.user('Hello 1');
  await team.ack('a', first.messageId);
  await team.send({ type: 'TEAM_ROLE_ERROR', chatId: 'chat', roleId: 'a', messageId: first.messageId, replyAttemptId: first.byRole.a.replyAttemptId, reason: 'Stopped by the user' }, 'a');
  const retried = await team.retry('a', first.messageId);
  assert.equal(retried.includesPersona, false);
  assert.match(retried.content, /Hello 1/);

  await team.send({ type: 'TEAM_ROLE_ERROR', chatId: 'chat', roleId: 'b', messageId: first.messageId, replyAttemptId: first.byRole.b.replyAttemptId, reason: 'Stopped by the user' }, 'b');
  const retriedB = await team.retry('b', first.messageId);
  assert.equal(retriedB.includesPersona, true);
});

test('clearing the chat starts every member from a fresh persona', async () => {
  const team = await startThemis({ mode: 'collaborative', roles: roles() });
  await team.turn('Hello 1');
  await team.send({ type: 'GROUP_CHAT_CLEAR_MESSAGES', chatId: 'chat' });
  await team.frameReady('a');
  await team.frameReady('b');
  const fresh = (await team.user('Hello again')).byRole;
  assert.equal(fresh.a.includesPersona, true);
  assert.equal(fresh.b.includesPersona, true);
  assert.doesNotMatch(fresh.a.content, /Hello 1/);
});

test('the "@Everyone" token inserted by the mention picker reaches every member', async () => {
  const team = await startThemis({ mode: 'independent', roles: roles() });
  const sent = await team.user('@Everyone Hello 1');
  assert.deepEqual(Object.keys(sent.byRole).sort(), ['a', 'b']);
  assert.match(sent.byRole.a.content, /Hello 1/);
  assert.doesNotMatch(sent.byRole.a.content, /@Everyone/);
});

test('custom GPT members never receive the persona text', async () => {
  const team = await startThemis({ mode: 'independent', roles: [{ id: 'g', name: 'GPT', chatSite: 'chatgpt', chatGptGptsUrl: 'https://chatgpt.com/g/g-test', systemPrompt: 'Secret persona' }] });
  for (const text of ['Hello 1', 'Hello 2']) {
    const sent = await team.turn(text);
    assert.doesNotMatch(sent.byRole.g.content, /Secret persona/);
  }
});
