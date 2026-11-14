const assert = require('node:assert/strict');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { importSource, sourceScript } = require('./test-support/source.cjs');

// 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function adapterFor(host, name, html) {
  const dom = new JSDOM(html, { url: `https://${host}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(sourceScript('test-support/content.ts', 'themisContent') + `;window.adapter=themisContent.${name}({ inputTimeoutMs: 800 });`);
  return { dom, adapter: dom.window.adapter };
}

test('ChatGPT and Gemini report their generated images, including blob: sources (as the live sites show them)', () => {
  // Trimmed from the live DOM (Nov 2026).
  const chatgpt = adapterFor('chatgpt.com', 'createChatGptAdapter', `<div id="reply"><div data-testid="generated-image-gallery"><div class="group/generated-image-preview"><button data-testid="generated-image-preview" aria-label="Generated image 1"><img width="1312" height="1199" alt="Generated image 1" src="blob:https://chatgpt.com/e13c089e"></button></div></div><p>Mèo phi hành gia.</p></div>`);
  const gemini = adapterFor('gemini.google.com', 'createGeminiAdapter', `<div id="reply"><p>Mèo phi hành gia.</p><div class="attachment-container generated-images"><response-element><generated-image><single-image class="generated-image"><div class="image-container"><button class="image-button"><img class="image loaded" width="1024" height="572" alt=", do AI tạo" src="blob:https://gemini.google.com/09026cba"></button></div></single-image></generated-image></response-element></div><response-element><full-width-image><div class="full-width-image-container"><img class="image" width="1600" height="1029" alt="chart" src="https://lh3.googleusercontent.com/gg/chart"></div></full-width-image></response-element><img class="avatar" width="24" height="24" src="https://www.gstatic.com/avatar.png"></div>`);
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(chatgpt.adapter.readResponseImages(chatgpt.dom.window.document.getElementById('reply')))),
      [{ sourceUrl: 'blob:https://chatgpt.com/e13c089e', alt: 'Generated image 1', width: 1312, height: 1199 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(gemini.adapter.readResponseImages(gemini.dom.window.document.getElementById('reply')))),
      [{ sourceUrl: 'blob:https://gemini.google.com/09026cba', alt: ', do AI tạo', width: 1024, height: 572 }, { sourceUrl: 'https://lh3.googleusercontent.com/gg/chart', alt: 'chart', width: 1600, height: 1029 }]);
  } finally {
    chatgpt.dom.window.close();
    gemini.dom.window.close();
  }
});

test('ChatGPT finds a generated image beside the caption, in the same exchange, and not the user\'s upload', () => {
  // Live layout (Nov 2026): one div[data-turn-key] per exchange, rows without author attributes.
  const { dom, adapter } = adapterFor('chatgpt.com', 'createChatGptAdapter', `
    <div data-turn-key="t1"><div class="flex flex-col">
      <div class="row"><span class="sr-only">You said:</span><div data-testid="image-upload-preview"><img width="800" height="600" src="blob:https://chatgpt.com/user-upload"></div>Vẽ cú</div>
      <div class="row"><div data-testid="generated-image-gallery"><button data-testid="generated-image-preview"><img width="1536" height="1024" alt="Generated image 1" src="blob:https://chatgpt.com/owl"></button></div></div>
      <div class="row"><figure><button aria-label="Expand chart"><img alt="Revenue by Quarter" width="790" height="490" src="data:application/octet-stream;base64,iVBORw0KGgo="></button><figcaption><button aria-label="Download chart"></button></figcaption></figure></div>
      <div class="row" id="caption"><span class="sr-only">ChatGPT said:</span><p>Chú cú đọc sách.</p></div>
    </div></div>
    <div data-turn-key="t2"><div data-testid="generated-image-gallery"><img src="blob:https://chatgpt.com/other-turn"></div></div>
    <section data-turn="assistant" data-testid="conversation-turn-6">
      <div data-testid="generated-image-gallery"><button data-testid="generated-image-preview"><img src="blob:https://chatgpt.com/legacy"></button></div>
      <div data-message-author-role="assistant" id="legacy-caption"><p>Cũ.</p></div>
    </section>`);
  try {
    const sources = id => [...adapter.readResponseImages(dom.window.document.getElementById(id))].map(image => String(image.sourceUrl));
    assert.deepEqual(sources('caption'), ['blob:https://chatgpt.com/owl', 'data:application/octet-stream;base64,iVBORw0KGgo=']);
    assert.deepEqual(sources('legacy-caption'), ['blob:https://chatgpt.com/legacy']);
  } finally { dom.window.close(); }
});

test('blob: images are read in the page as data URLs; other sources and non-images pass through unread', async () => {
  const { inlineReplyImages } = await importSource('src/content/inlineReplyImages.ts');
  // ChatGPT charts come as data:application/octet-stream PNGs: the bytes decide the type.
  const fetchImage = async url => new Response(url.includes('page') ? '<html>' : PNG, { headers: { 'content-type': url.includes('page') ? 'text/html' : url.includes('octet') ? 'application/octet-stream' : 'image/png' } });
  const images = await inlineReplyImages([
    { sourceUrl: 'blob:https://chatgpt.com/1', width: 1 },
    { sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=1' },
    { sourceUrl: 'blob:https://chatgpt.com/page' },
    { sourceUrl: 'data:application/octet-stream;base64,octet' },
  ], fetchImage);
  assert.deepEqual(images, [
    { sourceUrl: 'blob:https://chatgpt.com/1', width: 1, dataUrl: `data:image/png;base64,${PNG.toString('base64')}` },
    { sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=1' },
    { sourceUrl: 'blob:https://chatgpt.com/page' },
    { sourceUrl: 'data:application/octet-stream;base64,octet', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` },
  ]);
});

test('the background stores raster images from data URLs, refuses SVG and other types, and still downloads ChatGPT https images', async () => {
  const { createImageAttachmentService } = await importSource('src/background/imageAttachments.ts');
  const stored = [];
  let id = 0;
  const service = createImageAttachmentService({
    repository: { put: async record => { stored.push(record); }, deleteByIds: async () => {} },
    fetchImage: async () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
    newId: () => `image-${++id}`,
    now: () => 1,
  });
  const attachments = await service.captureReplyImages({ chatId: 'chat', messageId: 'message', images: [
    { sourceUrl: 'blob:https://gemini.google.com/1', dataUrl: `data:image/png;base64,${PNG.toString('base64')}`, width: 1024 },
    { sourceUrl: 'blob:https://gemini.google.com/2', dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}` },
    { sourceUrl: 'blob:https://gemini.google.com/3' },
    { sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=1' },
    { sourceUrl: 'https://lh3.googleusercontent.com/gg/chart' },
    { sourceUrl: 'https://example.com/elsewhere.png' },
  ] });
  assert.deepEqual(attachments.map(({ id, status, fileName, mimeType, size, error }) => ({ id, status, fileName, mimeType, size, error })), [
    { id: 'image-1', status: 'ready', fileName: 'reply-image-1.png', mimeType: 'image/png', size: PNG.length, error: undefined },
    { id: 'image-2', status: 'error', fileName: undefined, mimeType: undefined, size: undefined, error: 'Remote content is not an image' },
    { id: 'image-3', status: 'error', fileName: undefined, mimeType: undefined, size: undefined, error: 'Unsupported image source' },
    { id: 'image-4', status: 'ready', fileName: 'chatgpt-image-4.png', mimeType: 'image/png', size: PNG.length, error: undefined },
    { id: 'image-5', status: 'ready', fileName: 'gemini-image-5.png', mimeType: 'image/png', size: PNG.length, error: undefined },
    { id: 'image-6', status: 'error', fileName: undefined, mimeType: undefined, size: undefined, error: 'Unsupported image source' },
  ]);
  assert.deepEqual(stored.map(record => [record.id, record.blob.type, record.blob.size]), [['image-1', 'image/png', PNG.length], ['image-4', 'image/png', PNG.length], ['image-5', 'image/png', PNG.length]]);
  assert.deepEqual(Buffer.from(await stored[0].blob.arrayBuffer()), PNG);
});

test('a Gemini member reply with an image read in its page keeps its text and stores the image; a link-only image from another host is dropped, not the reply', async () => {
  const { startThemis } = require('./prompt-sync-harness.cjs');
  const team = await startThemis({ roles: [{ id: 'g', name: 'G' }] });
  const sent = await team.user('vẽ mèo');
  const prompt = sent.byRole.g;
  await team.ack('g', sent.messageId);
  const response = await team.send({
    type: 'TEAM_ROLE_REPLY', chatId: 'chat', roleId: 'g', messageId: prompt.messageId, replyAttemptId: prompt.replyAttemptId, content: 'Mèo.',
    images: [
      { sourceUrl: 'blob:https://gemini.google.com/1', dataUrl: `data:image/png;base64,${PNG.toString('base64')}`, width: 1024, height: 572 },
      { sourceUrl: 'https://example.com/elsewhere.png' },
    ],
  }, 'g');
  assert.equal(response.ok, true, response.error);
  const reply = Object.values((await team.store()).messagesById).find(message => message.type === 'assistant');
  assert.equal(reply.content, 'Mèo.');
  assert.deepEqual(reply.attachments.map(({ status, mimeType, width }) => ({ status, mimeType, width })), [{ status: 'ready', mimeType: 'image/png', width: 1024 }]);
  setImmediate(() => process.exit(0)); // background.js keeps keepalive timers alive
});
