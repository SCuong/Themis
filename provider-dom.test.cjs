const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { sourceScript } = require('./test-support/source.cjs');

const contentScript = sourceScript('test-support/content.ts', 'themisContent');

function createAdapter(host, html, name) {
  const dom = new JSDOM(html, {
    url: 'https://' + host + '/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  // The real adapter modules, without the content script's boot and runtime messaging.
  dom.window.eval(contentScript + ';window.adapters={chatgpt:themisContent.createChatGptAdapter,claude:themisContent.createClaudeAdapter,grok:themisContent.createGrokAdapter,gemini:themisContent.createGeminiAdapter,deepseek:themisContent.createDeepSeekAdapter};window.collectReply=themisContent.resolveReportableReplyText;');
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

test('Claude reads replies from its current assistant-message rows and ignores the user turn', () => {
  // Markup as claude.ai renders it since late 2026 (trimmed): no .font-claude-response any more.
  const { dom, adapter } = createAdapter('claude.ai', `
    <div data-testid="transcript-row"><div data-testid="user-message"><p>Reply with exactly: TOKEN</p></div></div>
    <div data-testid="transcript-row">
      <div data-testid="assistant-message" data-cds="AssistantMessage">
        <div class="contents" data-transcript-engine-root="">
          <div class="prose" data-cds="Prose">
            <div class="standard-markdown" data-perf-reply-text=""><p>CLAUDE-TOKEN-1</p></div>
          </div>
        </div>
        <div role="group" aria-label="Message actions"><button aria-label="Copy">Copy</button><button aria-label="Retry">Retry</button></div>
      </div>
    </div>
  `, 'claude');
  try {
    assert.deepEqual(Array.from(adapter.getAllAssistantReplies()), ['CLAUDE-TOKEN-1']);
  } finally { dom.window.close(); }
});

test('Claude still reads the earlier .font-claude-response layout', () => {
  const { dom, adapter } = createAdapter('claude.ai', '<div class="font-claude-response"><p>Older layout reply.</p></div>', 'claude');
  try {
    assert.deepEqual(Array.from(adapter.getAllAssistantReplies()), ['Older layout reply.']);
  } finally { dom.window.close(); }
});

test('Grok keeps waiting while its reply bubble only shows a connection status', () => {
  const { dom, adapter } = createAdapter('grok.com', '<div data-testid="assistant-message"><span>Reconnecting…</span></div>', 'grok');
  try {
    assert.equal(adapter.isGenerating(), true);
    dom.window.document.querySelector('[data-testid="assistant-message"]').innerHTML = '<p>THEMIS-GROK-TOKEN</p>';
    assert.equal(adapter.isGenerating(), false);
  } finally { dom.window.close(); }
});
