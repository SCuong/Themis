const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

function createAdapter(host, html, name) {
  const dom = new JSDOM(html, {
    url: 'https://' + host + '/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const source = readFileSync(require.resolve('./content.js'), 'utf8');
  const end = source.indexOf('var Tt="__THEMIS_LOADED__"');
  assert.ok(end > 0);
  // Execute production adapter functions, stopping before extension boot and runtime messaging.
  dom.window.eval(source.slice(0, end) + 'window.adapters={chatgpt:Qe,gemini:pt,deepseek:it};window.collectReply=le;})();');
  return { dom, adapter: dom.window.adapters[name]({ inputTimeoutMs: 800 }) };
}

test('ChatGPT fills the current composer and reads only assistant content', async () => {
  const { dom, adapter } = createAdapter('chatgpt.com', `
    <form data-chatgpt-composer>
      <div class="ProseMirror" contenteditable="true" data-composer-markdown></div>
      <button aria-label="Send" type="button"></button>
    </form>
    <div data-content-search-unit-key="turn:0:user">User prompt</div>
    <div data-markdown-text-style="assistant-message"><p>Xin chào từ ChatGPT.</p></div>
  `, 'chatgpt');
  try {
    let sent = 0;
    dom.window.document.querySelector('button').onclick = () => sent++;
    await adapter.fillAndSend('Kiểm thử mới');
    assert.equal(sent, 1);
    assert.equal(dom.window.document.querySelector('.ProseMirror').textContent, 'Kiểm thử mới');
    const replies = adapter.getAllAssistantReplies();
    assert.equal(replies.length, 1);
    assert.equal(replies[0], 'Xin chào từ ChatGPT.');
  } finally { dom.window.close(); }
});

test('reply collection uses the selected response DOM before a shared clipboard', async () => {
  const { dom, adapter } = createAdapter('gemini.google.com', `
    <model-response><message-content><p>KIEM-27 Nội dung đúng.</p></message-content></model-response>
  `, 'gemini');
  try {
    let clipboardReads = 0;
    adapter.readResponseTextFromCopy = async () => { clipboardReads++; return 'Câu trả lời của lượt cũ'; };
    const element = adapter.getResponseContainers()[0];
    const reply = await dom.window.collectReply(adapter, element, adapter.readResponseText(element), { warn() {} });
    assert.equal(reply.text, 'KIEM-27 Nội dung đúng.');
    assert.equal(clipboardReads, 0);
  } finally { dom.window.close(); }
});

test('Gemini clicks its Vietnamese nested send button and excludes speaker labels', async () => {
  const { dom, adapter } = createAdapter('gemini.google.com', `
    <div class="ql-editor" contenteditable="true"></div>
    <div data-test-id="send-button-container">
      <gem-icon-button class="send-button submit">
        <button aria-label="Gửi tin nhắn"><mat-icon data-mat-icon-name="arrow_upward"></mat-icon></button>
      </gem-icon-button>
    </div>
    <model-response><h2>Gemini đã nói</h2><div class="model-response-text">
      <message-content><p>Phản hồi mới.</p></message-content>
    </div></model-response>
  `, 'gemini');
  try {
    let sent = 0;
    dom.window.document.querySelector('button').onclick = () => sent++;
    await adapter.fillAndSend('KIEM-27');
    assert.equal(sent, 1);
    const replies = adapter.getAllAssistantReplies();
    assert.equal(replies.length, 1);
    assert.equal(replies[0], 'Phản hồi mới.');
    assert.equal(adapter.getResponseContainers().length, 1);
  } finally { dom.window.close(); }
});

test('DeepSeek keeps the final answer separate from its reasoning', () => {
  const { dom, adapter } = createAdapter('chat.deepseek.com', `
    <div data-virtual-list-item-key="turn-1">
      <div class="ds-message">
        <div class="ds-think-content"><div class="ds-markdown">Private reasoning</div></div>
        <div class="ds-markdown"><p>Trả lời từ DeepSeek.</p></div>
      </div>
    </div>
  `, 'deepseek');
  try {
    const replies = adapter.getAllAssistantReplies();
    assert.equal(replies.length, 1);
    assert.equal(replies[0], 'Trả lời từ DeepSeek.');
  } finally { dom.window.close(); }
});

test('Gemini remains generating while its Vietnamese stop button is enabled', () => {
  const { dom, adapter } = createAdapter('gemini.google.com', '<button aria-label="Dừng phản hồi"></button>', 'gemini');
  try {
    assert.equal(adapter.isGenerating(), true);
    dom.window.document.querySelector('button').disabled = true;
    assert.equal(adapter.isGenerating(), false);
  } finally { dom.window.close(); }
});

test('Gemini ignores hidden stop buttons and words that only contain "stop"', () => {
  const { dom, adapter } = createAdapter('gemini.google.com', `
    <button aria-label="Dừng phản hồi" style="display:none"></button>
    <button aria-label="Stop response" hidden></button>
    <button>Gemini for Desktop</button>
  `, 'gemini');
  try {
    assert.equal(adapter.isGenerating(), false);
  } finally { dom.window.close(); }
});

test('ChatGPT still reads the legacy response DOM', () => {
  const { dom, adapter } = createAdapter('chatgpt.com', `
    <section data-turn="assistant" data-testid="conversation-turn-2">
      <div data-message-author-role="assistant"><p>Legacy reply.</p></div>
    </section>
  `, 'chatgpt');
  try {
    assert.deepEqual(Array.from(adapter.getAllAssistantReplies()), ['Legacy reply.']);
  } finally { dom.window.close(); }
});

test('ChatGPT agent turns read the final answer, not the opening status line', () => {
  const { dom, adapter } = createAdapter('chatgpt.com', `
    <section data-turn="assistant" data-testid="conversation-turn-2">
      <div data-message-author-role="assistant" data-turn-start-message="true" data-message-id="a"><p>Checked tooling and cloned repository</p></div>
      <div data-message-author-role="assistant" data-message-id="b"><p>Kết luận: 2/5</p></div>
    </section>
  `, 'chatgpt');
  try {
    assert.deepEqual([...adapter.getAllAssistantReplies()], ['Kết luận: 2/5']);
  } finally { dom.window.close(); }
});
