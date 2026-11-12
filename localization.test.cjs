const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const shared = import('./assets/imageAttachmentRepository-DBrzc-g8.js');
const han = /\p{Script=Han}/u;

test('language normalization migrates Chinese settings and preserves English', async () => {
  const api = await shared;
  assert.equal(api.C().settings.language, 'vi');
  assert.equal(api.n('zh-CN'), 'vi');
  assert.equal(api.n('vi'), 'vi');
  assert.equal(api.n('en'), 'en');
  assert.equal(api.E('Chats', 'vi'), 'Cuộc trò chuyện');
  assert.equal(api.E('Cuộc trò chuyện', 'en'), 'Chats');
});

test('built-in people and chat templates have Vietnamese or English display content', async () => {
  const api = await shared;
  for (const language of ['vi', 'en']) {
    const people = api._(api.C()).map(person => api.Q(person, language));
    assert.ok(people.length > 300);
    for (const person of people) {
      assert.doesNotMatch([person.name, person.description, person.systemPrompt, person.category].join(' '), han);
    }
    const templates = api.Y({}).map(template => api.U(template, language));
    assert.ok(templates.length > 0);
    for (const template of templates) {
      assert.doesNotMatch([template.name, template.summary, template.category, ...template.userTypes, ...template.suggestedQuestions].join(' '), han);
      assert.doesNotMatch(api.V(template, language), han);
    }
  }
});

test('the initial HTML contains only Vietnamese and English interface copy', () => {
  const html = readFileSync(require.resolve('./team.html'), 'utf8');
  assert.doesNotMatch(html, han);
  assert.match(html, /id="language-vi"/);
  assert.match(html, /id="language-en"/);
});
