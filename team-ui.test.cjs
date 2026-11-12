const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

function loadUI(dom) {
  const source = readFileSync(require.resolve('./team-ui.js'), 'utf8').replaceAll('export function ', 'function ');
  dom.window.eval(source + ';window.ui={appendPersonaEditor,initializeTeamUI};');
  return dom.window.ui;
}

test('editing a member persona saves its linked template and keeps provider settings', async () => {
  const dom = new JSDOM('<div class="modal-backdrop"><section></section></div>', { runScripts: 'outside-only' });
  try {
    const api = loadUI(dom);
    const template = {
      id: 'template', type: 'custom', name: 'Engineer',
      systemPrompt: 'Old persona', defaultModelSource: 'site', defaultChatSite: 'chatgpt',
      chatGptGptsUrl: 'https://chatgpt.com/g/custom',
    };
    const calls = [];
    const container = dom.window.document.querySelector('section');
    api.appendPersonaEditor(container, dom.window.document.createElement('header'), dom.window.document.createElement('pre'),
      { templateId: 'template' }, { settings: { language: 'en' }, roleTemplatesById: { template } },
      async (...args) => { calls.push(args); });
    const input = container.querySelector('textarea');
    input.value = 'Trả lời bằng tiếng Việt.';
    container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await new Promise(setImmediate);
    assert.equal(calls[0][0], 'ROLE_TEMPLATE_UPDATE');
    assert.equal(calls[0][1].patch.systemPrompt, input.value);
    assert.equal(calls[0][1].patch.chatGptGptsUrl, template.chatGptGptsUrl);
    assert.equal(dom.window.document.querySelector('.modal-backdrop'), null);
  } finally { dom.window.close(); }
});

test('failed persona saves remain editable and show the error', async () => {
  const dom = new JSDOM('<section></section>', { runScripts: 'outside-only' });
  try {
    const api = loadUI(dom);
    const container = dom.window.document.querySelector('section');
    api.appendPersonaEditor(container, dom.window.document.createElement('header'), dom.window.document.createElement('pre'),
      { templateId: 'template' }, { settings: { language: 'en' }, roleTemplatesById: {
        template: { id: 'template', type: 'custom', name: 'Advisor', systemPrompt: 'Keep this draft' },
      } }, async () => { throw new Error('Save failed'); });
    container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await new Promise(setImmediate);
    assert.equal(container.querySelector('textarea').value, 'Keep this draft');
    assert.equal(container.querySelector('[role="alert"]').hidden, false);
    assert.equal(container.querySelector('button').disabled, false);
  } finally { dom.window.close(); }
});

test('every profile resolves to a local avatar group', async () => {
  const module = await import('data:text/javascript;base64,' + readFileSync(require.resolve('./profile-avatars.js')).toString('base64'));
  assert.equal(module.profileAvatarClass('ProductManager'), 'profile-portrait portrait-0');
  assert.equal(module.profileAvatarClass('Engineer'), 'profile-portrait portrait-1');
  assert.equal(module.profileAvatarClass('GrowthAdvisor'), 'profile-portrait portrait-2');
  assert.equal(module.profileAvatarClass('Giáo viên'), 'profile-portrait portrait-6');
  assert.equal(module.profileAvatarClass('Anything new'), 'profile-portrait portrait-11');
});
