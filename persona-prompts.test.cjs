// Detailed persona prompts are used as written, and the external CLI link cannot be switched on.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, after } = require('node:test');
const { startThemis } = require('./prompt-sync-harness.cjs');
const { importSource, dist } = require('./test-support/source.cjs');

after(() => setImmediate(() => process.exit(0))); // background.js keeps keepalive timers alive

const shared = () => importSource('test-support/shared.ts');

test('team template roles keep their own detailed prompts and descriptions', async () => {
  const m = await shared();
  const roles = m.localizeGroupTemplate(m.getBuiltinGroupTemplate('study-master')).roles;
  assert.ok(roles.length > 0);
  for (const role of roles) {
    assert.doesNotMatch(role.systemPrompt, new RegExp(`^You are ${role.name}\\.`), `${role.name} should not get the generic prompt`);
    assert.ok(role.systemPrompt.length > 200, `${role.name} prompt is detailed`);
    assert.doesNotMatch(role.name, /\s/, 'role names stay mention-safe');
  }
});

test('built-in personas keep their detailed prompt and only fall back when it is empty', async () => {
  const m = await shared();
  const persona = { id: 'builtin-frankl', type: 'builtin', name: 'ViktorFrankl', description: 'x', systemPrompt: 'Preamble.\n\nYou are a Frankl-style advisor built from logotherapy.' };
  assert.match(m.localizeRoleTemplate(persona).systemPrompt, /logotherapy/);
  assert.match(m.localizeRoleTemplate({ ...persona, systemPrompt: '' }).systemPrompt, /advisory persona inspired by public ideas/);
});

test('the external CLI link is gone: no settings toggle, no websocket CSP, and it cannot be enabled', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'team.html'), 'utf8');
  assert.doesNotMatch(html, /agent-control/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /ws:/);
  const background = fs.readFileSync(dist('background.js'), 'utf8');
  assert.doesNotMatch(background, /WebSocket|control-client|ws:\/\//, 'the control client code is removed');
  const team = await startThemis({ roles: [{ id: 'a', name: 'A' }] });
  await team.send({ type: 'GROUP_SETTINGS_UPDATE', agentControlEnabled: true, agentControlPort: 19305 });
  const settings = (await team.store()).settings;
  assert.deepEqual(Object.keys(settings).filter(key => /agentControl/.test(key)), [], 'no agent-control settings are stored');
});
