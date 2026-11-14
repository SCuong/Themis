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

// KaTeX output as ChatGPT, DeepSeek, Claude and Grok render it: MathML (symbols + TeX annotation) for screen readers,
// then an aria-hidden visual copy.
const katex = (tex, mathml, display = false) => {
  const math = `<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}><semantics><mrow>${mathml}</mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base">${mathml.replace(/<[^>]+>/g, '')}</span></span></span>`;
  return display ? `<span class="katex-display">${math}</span>` : math;
};

test('math replies keep each formula once, as its TeX source, not the MathML symbols run together', () => {
  const { dom, adapter } = createAdapter('chat.deepseek.com', `
    <div data-virtual-list-item-key="turn-1">
      <div class="ds-message"><div class="ds-markdown">
        <p><strong>a)</strong></p>
        ${katex(String.raw`\frac{2}{3}\sqrt{9}-\frac{3}{2}\sqrt{(-6)^2}+7`, '<mfrac><mn>2</mn><mn>3</mn></mfrac><msqrt><mn>9</mn></msqrt><mo>−</mo><mfrac><mn>3</mn><mn>2</mn></mfrac><msqrt><msup><mrow><mo>(</mo><mo>−</mo><mn>6</mn><mo>)</mo></mrow><mn>2</mn></msup></msqrt><mo>+</mo><mn>7</mn>', true)}
        <p>Ta có: ${katex(String.raw`\sqrt{9}=3`, '<msqrt><mn>9</mn></msqrt><mo>=</mo><mn>3</mn>')}, nên ${katex(String.raw`a_1 = \{x\}`, '<msub><mi>a</mi><mn>1</mn></msub><mo>=</mo><mo>{</mo><mi>x</mi><mo>}</mo>')}.</p>
      </div></div>
    </div>
  `, 'deepseek');
  try {
    const reply = dom.window.document.querySelector('.ds-markdown');
    assert.equal(adapter.readResponseMarkdown(reply), [
      '**a)**',
      '',
      String.raw`$$\frac{2}{3}\sqrt{9}-\frac{3}{2}\sqrt{(-6)^2}+7$$`,
      '',
      String.raw`Ta có: $\sqrt{9}=3$, nên $a_1 = \{x\}$.`,
    ].join('\n'));
  } finally { dom.window.close(); }
});

// Code cards as each site renders them (trimmed from the live DOM, Nov 2026): a header with the language and copy
// controls around one code element. Each must become one fenced block tagged with the language, without header text.
const CODE = 'def f(n):\n    return n | 1';
const codeCards = {
  chatgpt: `<div class="relative"><div class="sticky"><span>Python</span><button aria-label="Copy">Copy</button></div><div class="cm-editor"><div class="cm-scroller"><div class="cm-content" role="textbox" data-language="python"><div class="cm-line"><span>def</span> f(n):</div><div class="cm-line">    return n | 1</div></div></div></div></div>`,
  claude: `<div role="group" aria-label="python code"><div class="sticky"><button aria-label="Copy to clipboard"></button></div><div class="text-text-500">python</div><div class="overflow-x-auto"><pre class="code-block__code"><code class="language-python"><span class="block">def f(n):</span>\n<span class="block">    return n | 1</span></code></pre></div></div>`,
  gemini: `<response-element><code-block><div class="code-block"><div class="code-block-decoration header-formatted"><span>Python</span><div class="buttons"><gem-icon-button><button aria-label="Tải mã xuống"></button></gem-icon-button></div></div><pre><code role="text">${CODE.replace('|', '&#124;')}</code></pre></div></code-block></response-element>`,
  deepseek: `<div class="md-code-block"><div class="md-code-block-banner-wrap"><div class="md-code-block-banner"><span class="d813de27">python</span><div class="efa13877"><div role="button" class="ds-button"><span>Copy</span></div><div role="button" class="ds-button"><span>Download</span></div></div></div></div><pre>${CODE}</pre></div>`,
  grok: `<div data-markdown-code="" data-code-card=""><div class="header"><span><svg aria-hidden="true"></svg><span><bdi>Python</bdi></span></span><div data-pdf-exclude=""><button aria-label="Copy code"></button></div></div><pre class="grok-pre"><code>${CODE}</code></pre></div>`,
};
for (const [site, card] of Object.entries(codeCards)) {
  test(`${site}: a code card becomes one fenced block tagged with its language, without header or button text`, () => {
    const host = { chatgpt: 'chatgpt.com', claude: 'claude.ai', gemini: 'gemini.google.com', deepseek: 'chat.deepseek.com', grok: 'grok.com' }[site];
    const { dom, adapter } = createAdapter(host, `<div id="reply"><p>Code:</p>${card}<p>Xong.</p></div>`, site);
    try {
      const reply = dom.window.document.getElementById('reply');
      assert.equal(adapter.readResponseMarkdown(reply), `Code:\n\n\`\`\`python\n${CODE}\n\`\`\`\n\nXong.`);
    } finally { dom.window.close(); }
  });
}

test('table cells keep inline formatting and each formula once; Gemini formulas come from data-math', () => {
  const { dom, adapter } = createAdapter('gemini.google.com', `
    <div id="reply">
      <p>Độ phức tạp ${'<span class="math-inline" data-math="\\mathcal{O}(\\sqrt{n})"><span class="katex"><span class="katex-mathml"></span><span class="katex-html" aria-hidden="true">O(n​)</span></span></span>'}:</p>
      <div class="math-block" data-math="\\sum_{i=1}^n i"><span class="katex-display"><span class="katex"><span class="katex-mathml"></span><span class="katex-html" aria-hidden="true">∑i</span></span></span></div>
      <table><thead><tr><th>Cách</th><th>Độ phức tạp</th></tr></thead>
      <tbody><tr><td><b>Chia thử</b> a|b</td><td>${katex(String.raw`O(\sqrt{n})`, '<mi>O</mi><mo>(</mo><msqrt><mi>n</mi></msqrt><mo>)</mo>')}</td></tr></tbody></table>
    </div>`, 'gemini');
  try {
    assert.equal(adapter.readResponseMarkdown(dom.window.document.getElementById('reply')), [
      String.raw`Độ phức tạp $\mathcal{O}(\sqrt{n})$:`,
      '',
      String.raw`$$\sum_{i=1}^n i$$`,
      '',
      'Cách | Độ phức tạp',
      ' --- | ---',
      String.raw`**Chia thử** a\|b | $O(\sqrt{n})$`,
    ].join('\n'));
  } finally { dom.window.close(); }
});

test('bold and italic keep their spaces outside the markers, as Markdown needs', () => {
  // Live ChatGPT DOM (Nov 2026): <strong>Tải xuống file </strong><strong>CSV</strong> became "**Tải xuống file ****CSV**".
  const { dom, adapter } = createAdapter('chatgpt.com', `<div id="reply"><p><strong>Tải xuống file </strong><strong>CSV</strong> và<em> nghiêng</em>.</p></div>`, 'chatgpt');
  try {
    assert.equal(adapter.readResponseMarkdown(dom.window.document.getElementById('reply')), '**Tải xuống file** **CSV** và *nghiêng*.');
  } finally { dom.window.close(); }
});

test('screen-reader-only labels stay out of the reply, and inline code holding backticks keeps its span', () => {
  const { dom, adapter } = createAdapter('grok.com', `
    <div id="reply"><h2 class="sr-only">Grok</h2><span class="visually-hidden">ChatGPT said:</span>
      <p>Dùng <code>a\`b</code> và <code>x</code>.</p></div>`, 'grok');
  try {
    assert.equal(adapter.readResponseMarkdown(dom.window.document.getElementById('reply')), 'Dùng `` a`b `` và `x`.');
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

test('files and videos in a reply leave a line naming them instead of vanishing with their buttons', () => {
  // ChatGPT file card (live DOM, Nov 2026): the file name is only in the preview button's label.
  const { dom, adapter } = createAdapter('chatgpt.com', `<div id="reply"><p>Đây là file:</p><div class="resource"><span class="group/resource-row"><button aria-label="Open preview of revenue_by_quarter.csv"></button><span>Spreadsheet</span><button aria-label="Download revenue_by_quarter.csv"></button><button aria-label="Download file"></button></span></div><video src="https://cdn.example.com/clip.mp4" controls></video><video src="blob:https://grok.com/v1"></video></div>`, 'chatgpt');
  try {
    assert.equal(adapter.readResponseMarkdown(dom.window.document.getElementById('reply')),
      'Đây là file:\n\n📎 revenue_by_quarter.csv\n\nSpreadsheet\n\n🎬 [video](https://cdn.example.com/clip.mp4)\n\n🎬 video');
  } finally { dom.window.close(); }
});

test('web citations become numbered links, and source links inside cards keep their URL', () => {
  // DeepSeek citation chips (live DOM, Nov 2026): an invisible "-" spacer, then the number; ChatGPT news card: a source
  // link inside divs, not a paragraph.
  const { dom, adapter } = createAdapter('chat.deepseek.com', `<div id="reply"><p>Sự cố đã được khắc phục.<span data-citation-group="1"><a href="https://www.bernama.com/n?id=1" aria-label="3"><span class="ds-markdown-cite"><span style="opacity: 0">-</span><span>3</span></span></a><a href="https://news.cctv.com/a" aria-label="15"><span class="ds-markdown-cite"><span style="opacity: 0">-</span><span>15</span></span></a></span></p><div class="card"><div class="frame"><a aria-label="fintechshield.co.in" href="https://www.fintechshield.co.in/post/x"><span>fintechshield.co.in</span></a></div></div></div>`, 'deepseek');
  try {
    assert.equal(adapter.readResponseMarkdown(dom.window.document.getElementById('reply')),
      'Sự cố đã được khắc phục. [[3]](https://www.bernama.com/n?id=1) [[15]](https://news.cctv.com/a)\n[fintechshield.co.in](https://www.fintechshield.co.in/post/x)');
  } finally { dom.window.close(); }
});

test('artifacts and interactive views named in their own line, since their content opens outside the reply', () => {
  // Live DOM (Nov 2026): Claude's artifact card sits beside the reply text in the assistant message; ChatGPT's
  // interactive view is a sandbox iframe in the same exchange as the caption.
  const claude = createAdapter('claude.ai', `<div data-testid="assistant-message"><div data-cds="Card"><span data-testid="frame-card-open" role="button" aria-label="View Bộ đếm">Bộ đếm</span><span>Artifact</span></div><div data-perf-reply-text="" id="reply"><p>Mình đã tạo xong artifact.</p></div></div>`, 'claude');
  const chatgpt = createAdapter('chatgpt.com', `<div data-turn-key="t1"><div><iframe src="https://codex-inline-visualization-1.web-sandbox.oaiusercontent.com/?app=skybridge"></iframe></div><div data-message-author-role="assistant" id="reply"><p>Thử bấm nút nhé.</p></div></div>`, 'chatgpt');
  try {
    assert.equal(claude.adapter.readResponseMarkdown(claude.dom.window.document.getElementById('reply')), 'Mình đã tạo xong artifact.\n\n🧩 Bộ đếm (artifact)');
    assert.equal(chatgpt.adapter.readResponseMarkdown(chatgpt.dom.window.document.getElementById('reply')), 'Thử bấm nút nhé.\n\n🧩 interactive view');
  } finally { claude.dom.window.close(); chatgpt.dom.window.close(); }
});
