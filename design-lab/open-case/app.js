// OPEN CASE — replies are drafted in a fixed-height tray and only "filed" into the case when finished,
// so the page never shifts under the reader. Disputes come first; the margin carries notes, timing and links.
(() => {
  const { createRoom, md, esc, fmtClock, fmtDuration } = ThemisMock;
  const room = createRoom();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
  const plain = s => s.replace(/```\w*/g, '').replace(/\*\*|`|\*/g, '').replace(/- \[ \] /g, '');
  const nameOf = id => (id === 'user' ? 'Bạn' : room.member(id).name);
  const mono = m => `<span class="mono" aria-hidden="true">${esc(m.monogram)}</span>`;
  const allIds = room.members.map(m => m.id);
  const STATUS = { idle: 'Chưa lên tiếng', waiting: 'Đang đọc câu hỏi', streaming: 'Đang viết', done: 'Đã trả lời', error: 'Lỗi gửi' };

  const state = { view: 'case', filter: null, notes: new Map(), quote: null, recipients: new Set(allIds), newDisputes: new Set(), selection: null };
  const entries = new Map();
  const drafts = new Map();
  const rounds = new Map();

  // ---------- masthead ----------
  $('#room-title').textContent = room.room.title;
  $('#question').innerHTML = esc(room.room.question).replace('thứ Năm', '<em>thứ Năm</em>');
  function renderMeta() {
    const n = new Set(room.messages.map(m => m.round)).size;
    $('#meta').textContent = `Hồ sơ mở · ${room.members.length} thành viên · ${n} vòng · ${room.room.mode}`;
  }

  // ---------- people (built once, statuses patched in place so focus survives) ----------
  $('#people').innerHTML = room.members.map(m => `
    <li><button class="person" type="button" data-person="${m.id}" aria-pressed="false">
      ${mono(m)}<span><b>${esc(m.name)}</b> <span class="role">${esc(m.role)} · ${esc(m.site)}</span></span>
      <span class="status"></span>
    </button></li>`).join('');
  function lastMessageOf(id) { return [...room.messages].reverse().find(x => x.author === id); }
  function renderStatuses() {
    for (const m of room.members) {
      const msg = lastMessageOf(m.id);
      const s = m.status === 'idle' && msg ? 'done' : m.status;
      let time = '';
      if (msg && (s === 'waiting' || s === 'streaming')) time = ` · ${fmtDuration(room.now() - msg.at)}`;
      else if (msg && s === 'done') time = ` · ${fmtClock(msg.doneAt)}`;
      else if (s === 'error') time = ` · ${m.site}`;
      $(`[data-person="${m.id}"] .status`).innerHTML = `<i class="sig ${s}" aria-hidden="true"></i>${STATUS[s]}${time}`;
    }
    const active = room.members.filter(m => m.status === 'waiting' || m.status === 'streaming').length;
    const failed = room.members.filter(m => m.status === 'error').length;
    $('#mobile-status').textContent = active || failed
      ? [active && `${active} đang viết`, failed && `${failed} lỗi gửi`].filter(Boolean).join(' · ')
      : 'Tất cả đã trả lời';
  }
  $('#people').addEventListener('click', e => {
    const b = e.target.closest('[data-person]');
    if (b) setFilter(state.filter === b.dataset.person ? null : b.dataset.person);
  });

  function setFilter(id) {
    state.filter = id;
    $$('[data-person]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.person === id)));
    for (const [msgId, el] of entries) el.hidden = !!id && room.message(msgId).author !== id;
    const note = $('#filter-note');
    note.hidden = !id;
    if (id) {
      const count = room.messages.filter(m => m.author === id && m.status === 'done').length;
      note.innerHTML = `Chỉ đọc <b>${esc(nameOf(id))}</b> · ${count} mục. <button type="button" data-clear-filter>Đọc cả hồ sơ</button>`;
    }
    setView('case');
    closeIndex();
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-clear-filter]')) setFilter(null); });

  // ---------- table of contents + log ----------
  function renderToc() {
    const items = [`<li><a class="dispute-link" href="#disputes"><span>≠</span><span>Còn bất đồng (${room.disagreements.length})</span></a></li>`];
    for (const [round, el] of rounds) {
      const q = plain(room.messages.find(m => m.round === round && m.author === 'user').fullText).replace(/@\S+\s*/g, '');
      items.push(`<li><a href="#${el.id}"><span>${round}</span><span>Vòng ${round}<span class="snip">${esc(q)}</span></span></a></li>`);
    }
    $('#toc').innerHTML = items.join('');
  }
  const LOG_VERB = { user: '', streaming: 'bắt đầu viết', done: 'đã vào hồ sơ', error: 'lỗi gửi', retry: 'đang gửi lại', followup: '', disagreement: '' };
  function renderLog() {
    $('#log').innerHTML = room.activity.slice(-7).reverse().map(a => {
      const who = a.memberId === 'user' ? 'Bạn' : nameOf(a.memberId);
      const text = LOG_VERB[a.kind] || a.text;
      return `<li class="${a.kind === 'error' ? 'is-error' : ''}"><time>${fmtClock(a.at)}</time><span><b>${esc(who)}</b> ${esc(text)}</span></li>`;
    }).join('') || '<li><time></time><span>Chưa có hoạt động mới.</span></li>';
  }

  // ---------- disputes ----------
  function sideMessage(side) {
    if (side.messageId) return room.message(side.messageId);
    const q = fold(plain(side.quote)).slice(0, 40);
    return [...room.messages].reverse().find(m => m.author === side.memberId && m.status === 'done' && fold(plain(m.fullText)).includes(q));
  }
  function renderDisputes() {
    $('#dispute-list').innerHTML = room.disagreements.map((d, i) => {
      const sides = d.sides.map(s => {
        const msg = sideMessage(s);
        return `<div class="side">
          <div class="stance">${esc(nameOf(s.memberId))} <b>${esc(s.stance)}</b></div>
          <blockquote>“${esc(s.quote)}”</blockquote>
          ${msg ? `<button class="text-btn ctx" type="button" data-goto="${msg.id}">Đọc trong ngữ cảnh</button>` : ''}
        </div>`;
      });
      const isNew = state.newDisputes.has(d.id);
      return `<article class="dispute${isNew ? ' is-new' : ''}" id="dispute-${d.id}">
        <div class="dispute-head"><span class="no">${String(i + 1).padStart(2, '0')}</span><h3>${esc(d.topic)}</h3>
          <span class="state">${isNew ? 'Mới mở' : 'Đang mở'} · ${fmtClock(d.at)}</span></div>
        <div class="sides">${sides[0]}<div class="vs" aria-hidden="true"><span>≠</span></div>${sides[1]}</div>
        <div class="dispute-foot"><button class="text-btn" type="button" data-arbiter="${d.id}">Nhờ người thứ ba phân xử</button></div>
      </article>`;
    }).join('');
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-arbiter]');
    if (!a) return;
    const d = room.disagreements.find(x => x.id === a.dataset.arbiter);
    const involved = d.sides.map(s => s.memberId);
    const others = allIds.filter(id => !involved.includes(id));
    const pick = others.includes('rook') ? ['rook'] : others.slice(0, 1);
    state.quote = null;
    setRecipients(new Set(pick));
    $('#composer-text').value = `${pick.map(id => '@' + nameOf(id)).join(' ')} ${involved.map(nameOf).join(' và ')} đang bất đồng về “${d.topic}”. Bạn đứng ở đâu, và vì sao?`;
    renderComposerQuote();
    focusComposer();
  });

  // ---------- argument matrix ----------
  function renderMatrix() {
    const head = `<thead><tr><th scope="col">Điểm tranh cãi</th>${room.members.map(m => `<th scope="col">${mono(m)}${esc(m.name)}</th>`).join('')}</tr></thead>`;
    const body = room.disagreements.map(d => `<tr><th scope="row">${esc(d.topic)}<small>${state.newDisputes.has(d.id) ? 'Mới mở' : 'Đang mở'}</small></th>${room.members.map(m => {
      const s = d.sides.find(x => x.memberId === m.id);
      if (!s) return '<td><span class="silent">Chưa lên tiếng</span></td>';
      const msg = sideMessage(s);
      return `<td><button class="cell" type="button" ${msg ? `data-goto="${msg.id}"` : ''}><b>${esc(s.stance)}</b><q>${esc(s.quote)}</q></button></td>`;
    }).join('')}</tr>`).join('');
    $('#matrix').innerHTML = head + `<tbody>${body}</tbody>`;
  }

  // ---------- rounds ----------
  function ensureRound(msg) {
    if (rounds.has(msg.round)) return rounds.get(msg.round);
    const el = document.createElement('section');
    el.className = 'round';
    el.id = `round-${msg.round}`;
    const to = msg.to === 'all' || (Array.isArray(msg.to) && msg.to.length === allIds.length) ? 'cả nhóm' : (msg.to || []).map(nameOf).join(', ');
    el.innerHTML = `
      <header class="round-head">
        <p class="eyebrow"><span>Vòng ${msg.round}</span><span>${fmtClock(msg.at)}</span></p>
        <div>
          <p class="ask-to">Bạn hỏi ${esc(to)}</p>
          ${msg.quote ? quoteHTML(msg.quote) : ''}
          <div class="ask">${md(msg.fullText)}</div>
        </div>
      </header>
      <div class="filed"></div>
      <div class="drafts" aria-live="polite"></div>`;
    $('#rounds').append(el);
    rounds.set(msg.round, el);
    renderToc();
    renderMeta();
    return el;
  }
  function quoteHTML(q) {
    return `<blockquote class="quoted">“${esc(q.text)}”<cite>Trích ${esc(nameOf(q.memberId))}</cite></blockquote>`;
  }

  // ---------- filed entries ----------
  function fileEntry(msg, live) {
    const m = room.member(msg.author);
    const el = document.createElement('article');
    el.className = 'entry';
    el.id = `e-${msg.id}`;
    el.tabIndex = -1;
    el.dataset.author = msg.author;
    el.innerHTML = `
      <div class="entry-body">
        <header class="byline">${mono(m)}<b>${esc(m.name)}</b><span class="who">${esc(m.role)} · ${esc(m.site)}</span>
          <time datetime="${new Date(msg.doneAt).toISOString()}">${fmtClock(msg.doneAt)}</time></header>
        ${msg.quote ? quoteHTML(msg.quote) : ''}
        <div class="prose">${md(msg.fullText)}</div>
      </div>
      <aside class="margin" aria-label="Ghi chú lề cho ${esc(m.name)}"></aside>`;
    el.hidden = !!state.filter && state.filter !== msg.author;
    ensureRound(msg).querySelector('.filed').append(el);
    entries.set(msg.id, el);
    if (live) {
      io.observe(el);
      const r = el.getBoundingClientRect();
      if (state.view !== 'case' || r.top > innerHeight - 40 || el.hidden) showNotice(msg);
    }
  }

  function renderMargin(msgId) {
    const msg = room.message(msgId);
    const el = entries.get(msgId);
    const margin = el.querySelector('.margin');
    const notes = [];
    const think = (msg.firstAt || msg.at) - msg.at;
    const write = msg.doneAt - (msg.firstAt || msg.at);
    notes.push(`<div class="note always"><span class="k" aria-hidden="true">◷</span><span>Nghĩ ${fmtDuration(think)} · viết ${fmtDuration(write)}</span></div>`);
    room.disagreements.forEach((d, i) => {
      const mine = d.sides.find(s => sideMessage(s)?.id === msgId);
      if (!mine) return;
      const other = d.sides.find(s => s !== mine);
      notes.push(`<div class="note dispute-note"><span class="k">${String(i + 1).padStart(2, '0')}</span><span><b>${esc(d.topic)}</b><br>
        ${esc(nameOf(mine.memberId))}: “${esc(mine.stance)}” — ${esc(nameOf(other.memberId))}: “${esc(other.stance)}”.
        <button class="text-btn" type="button" data-goto-dispute="${d.id}">Xem đối chiếu</button></span></div>`);
    });
    room.messages.filter(x => x.quote && x.quote.messageId === msgId && x.author !== 'user' && x.status === 'done').forEach(x => {
      notes.push(`<div class="note"><span class="k" aria-hidden="true">↳</span><span><b>${esc(nameOf(x.author))}</b> đã phản biện một đoạn ở đây. <button class="text-btn" type="button" data-goto="${x.id}">Đọc</button></span></div>`);
    });
    if (msg.quote && msg.quote.messageId && entries.has(msg.quote.messageId)) {
      notes.push(`<div class="note"><span class="k" aria-hidden="true">↰</span><span>Trả lời một đoạn của <b>${esc(nameOf(msg.quote.memberId))}</b>. <button class="text-btn" type="button" data-goto="${msg.quote.messageId}">Xem gốc</button></span></div>`);
    }
    (state.notes.get(msgId) || []).forEach(n => {
      notes.push(`<div class="note user-note"><span class="k" aria-hidden="true"></span><span><span contenteditable="true" role="textbox" aria-label="Ghi chú của bạn" data-note="${n.id}" data-msg="${msgId}">${esc(n.text)}</span></span></div>`);
    });
    const extra = notes.length - 1;
    const open = margin.classList.contains('is-open');
    margin.innerHTML = (extra ? `<button class="text-btn margin-toggle" type="button" aria-expanded="${open}">Ghi chú lề (${extra})</button>` : '') + notes.join('');
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('.margin-toggle');
    if (!t) return;
    const margin = t.closest('.margin');
    margin.classList.toggle('is-open');
    t.setAttribute('aria-expanded', String(margin.classList.contains('is-open')));
  });

  // Underline disputed sentences with the CSS Custom Highlight API; mark their paragraph with a red rule.
  function rangeFor(root, needle) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    while (walker.nextNode()) { nodes.push([walker.currentNode, text.length]); text += walker.currentNode.data; }
    const hay = text.toLowerCase();
    let n = needle.toLowerCase().trim();
    let i = hay.indexOf(n);
    if (i < 0) { n = n.replace(/[.!?]+$/, ''); i = hay.indexOf(n); }
    if (i < 0) { n = n.slice(0, 40); i = hay.indexOf(n); }
    if (i < 0 || !n) return null;
    const pos = off => { for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k][1] <= off) return [nodes[k][0], off - nodes[k][1]]; };
    const r = document.createRange();
    r.setStart(...pos(i));
    r.setEnd(...pos(i + n.length));
    return r;
  }
  function refreshMarks() {
    $$('.has-dispute').forEach(p => p.classList.remove('has-dispute'));
    const disputed = [], quoted = [];
    for (const d of room.disagreements) for (const s of d.sides) {
      const msg = sideMessage(s);
      const prose = msg && entries.get(msg.id)?.querySelector('.prose');
      const r = prose && rangeFor(prose, plain(s.quote));
      if (!r) continue;
      disputed.push(r);
      r.startContainer.parentElement.closest('p, li')?.classList.add('has-dispute');
    }
    for (const msg of room.messages) {
      if (!msg.quote || !msg.quote.messageId) continue;
      const prose = entries.get(msg.quote.messageId)?.querySelector('.prose');
      const r = prose && rangeFor(prose, msg.quote.text);
      if (r) quoted.push(r);
    }
    if (window.Highlight && CSS.highlights) {
      CSS.highlights.set('dispute', new Highlight(...disputed));
      CSS.highlights.set('quoted', new Highlight(...quoted));
    }
  }
  function refreshLinks() {
    for (const id of entries.keys()) renderMargin(id);
    refreshMarks();
    renderDisputes();
    renderMatrix();
    renderToc();
  }

  // ---------- drafts tray ----------
  function trayOf(msg) { return ensureRound(room.messages.find(m => m.round === msg.round && m.author === 'user') || msg).querySelector('.drafts'); }
  function upsertDraft(msg) {
    let el = drafts.get(msg.id);
    const m = room.member(msg.author);
    if (!el) {
      el = document.createElement('div');
      el.className = 'draft';
      el.id = `d-${msg.id}`;
      el.innerHTML = `${mono(m)}<div class="draft-who"><b>${esc(m.name)}</b><span class="draft-state"></span></div><span class="draft-time"></span><div class="draft-line"></div>`;
      drafts.set(msg.id, el);
      const tray = trayOf(msg);
      if (!tray.querySelector('.drafts-h')) tray.insertAdjacentHTML('afterbegin', '<div class="drafts-h"><span>Bản nháp đang viết</span><span class="drafts-n"></span></div>');
      tray.append(el);
    }
    el.className = `draft is-${msg.status}`;
    const line = el.querySelector('.draft-line');
    if (msg.status === 'waiting') {
      el.querySelector('.draft-state').textContent = `${m.site} · ${STATUS.waiting}`;
      line.textContent = `Câu hỏi đã tới ${m.site}. Chưa có chữ nào.`;
      el.querySelector('.retry')?.remove();
    } else if (msg.status === 'streaming') {
      el.querySelector('.draft-state').textContent = `${m.site} · ${STATUS.streaming}`;
      const tail = plain(msg.text).replace(/\s+/g, ' ').slice(-170);
      line.innerHTML = `<span>${esc(tail)}<span class="caret" aria-hidden="true"></span></span>`;
    } else if (msg.status === 'error') {
      const others = room.messages.filter(x => x.round === msg.round && x.author !== 'user' && x.id !== msg.id && (x.status === 'waiting' || x.status === 'streaming')).length;
      el.querySelector('.draft-state').textContent = m.site;
      line.innerHTML = `<b>Chưa gửi được tới ${esc(m.name)}.</b> ${esc(msg.error)} ${others ? `${others} thành viên khác vẫn đang trả lời.` : 'Các thành viên khác không bị ảnh hưởng.'}`;
      if (!el.querySelector('.retry')) el.insertAdjacentHTML('beforeend', `<button class="retry" type="button" data-retry="${m.id}">Thử lại với ${esc(m.name)}</button>`);
    }
    countDrafts(el.parentElement);
  }
  function countDrafts(tray) {
    if (!tray) return;
    const n = tray.querySelectorAll('.draft').length;
    if (!n) { tray.innerHTML = ''; return; }
    tray.querySelector('.drafts-n').textContent = n;
  }
  function tickDrafts() {
    for (const [id, el] of drafts) {
      const msg = room.message(id);
      if (msg.status === 'error') upsertDraft(msg); // keeps "N thành viên khác vẫn đang trả lời" true as others finish
      el.querySelector('.draft-time').textContent = msg.status === 'error' ? '' : fmtDuration(room.now() - msg.at);
    }
    renderStatuses();
  }
  document.addEventListener('click', e => {
    const r = e.target.closest('[data-retry]');
    if (r) room.retry(r.dataset.retry);
  });

  // ---------- notice for things filed out of view ----------
  const notice = $('#notice');
  let noticeFor = null;
  function showNotice(msg) {
    noticeFor = msg.id;
    notice.textContent = `${nameOf(msg.author)} vừa vào hồ sơ ↓`;
    notice.hidden = false;
  }
  notice.addEventListener('click', () => { if (noticeFor) goto(noticeFor); notice.hidden = true; });
  const io = new IntersectionObserver(list => list.forEach(x => {
    if (x.isIntersecting && x.target.id === `e-${noticeFor}` && state.view === 'case') notice.hidden = true;
  }), { threshold: 0.2 });

  function goto(msgId) {
    const el = entries.get(msgId);
    if (!el) return;
    if (el.hidden) setFilter(null);
    setView('case');
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  }
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (g) { goto(g.dataset.goto); return; }
    const d = e.target.closest('[data-goto-dispute]');
    if (d) { setView('case'); $(`#dispute-${d.dataset.gotoDispute}`).scrollIntoView({ block: 'center' }); }
  });

  // ---------- views ----------
  function setView(v) {
    state.view = v;
    $('#tab-case').setAttribute('aria-selected', String(v === 'case'));
    $('#tab-args').setAttribute('aria-selected', String(v === 'args'));
    $('#tab-case').tabIndex = v === 'case' ? 0 : -1;
    $('#tab-args').tabIndex = v === 'args' ? 0 : -1;
    $('#view-case').hidden = v !== 'case';
    $('#view-args').hidden = v !== 'args';
  }
  $('#tab-case').onclick = () => setView('case');
  $('#tab-args').onclick = () => setView('args');
  $('.views').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    setView(state.view === 'case' ? 'args' : 'case');
    $(state.view === 'case' ? '#tab-case' : '#tab-args').focus();
  });

  // ---------- composer ----------
  function setRecipients(set) {
    state.recipients = set.size ? set : new Set(allIds);
    const all = state.recipients.size === allIds.length;
    $('#recipients').innerHTML = `<button type="button" class="chip all" data-chip="all" aria-pressed="${all}">Cả nhóm</button>` +
      room.members.map(m => `<button type="button" class="chip" data-chip="${m.id}" aria-pressed="${!all && state.recipients.has(m.id)}">${mono(m)}${esc(m.name)}</button>`).join('');
    $('#send').textContent = all ? 'Gửi cho cả nhóm' : `Gửi cho ${[...state.recipients].map(nameOf).join(', ')}`;
  }
  $('#recipients').addEventListener('click', e => {
    const c = e.target.closest('[data-chip]');
    if (!c) return;
    if (c.dataset.chip === 'all') return setRecipients(new Set(allIds));
    const all = state.recipients.size === allIds.length;
    const next = all ? new Set() : new Set(state.recipients);
    next.has(c.dataset.chip) ? next.delete(c.dataset.chip) : next.add(c.dataset.chip);
    setRecipients(next);
  });
  $('#composer-text').addEventListener('input', e => {
    const f = fold(e.target.value);
    if (/@all\b/.test(f)) return setRecipients(new Set(allIds));
    const named = room.members.filter(m => f.includes('@' + fold(m.name))).map(m => m.id);
    if (named.length) setRecipients(new Set(named));
  });
  $('#composer-text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  function renderComposerQuote() {
    const box = $('#composer-quote');
    box.hidden = !state.quote;
    if (state.quote) box.innerHTML = `<blockquote>“${esc(state.quote.text)}”<br><small>Trích ${esc(nameOf(state.quote.memberId))}</small></blockquote><button class="text-btn" type="button" data-unquote>Bỏ trích</button>`;
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-unquote]')) { state.quote = null; renderComposerQuote(); } });
  function focusComposer() {
    setView('case');
    const t = $('#composer-text');
    $('#composer').scrollIntoView({ block: 'center' });
    t.focus({ preventScroll: true });
    t.setSelectionRange(t.value.length, t.value.length);
  }
  $('#composer').addEventListener('submit', e => {
    e.preventDefault();
    const t = $('#composer-text');
    if (!t.value.trim()) { t.focus(); return; }
    const msg = room.send({ text: t.value, to: [...state.recipients], quote: state.quote });
    t.value = '';
    state.quote = null;
    renderComposerQuote();
    setRecipients(new Set(allIds));
    rounds.get(msg.round)?.scrollIntoView({ block: 'start' });
  });

  // ---------- selection → critique / margin note ----------
  const tool = $('#seltool');
  function hideTool() { tool.hidden = true; tool.querySelector('.seltool-pick').hidden = true; tool.querySelector('.seltool-main').hidden = false; }
  function onSelect() {
    const sel = getSelection();
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    const entry = sel.rangeCount && sel.anchorNode && sel.anchorNode.parentElement?.closest('.entry .prose') && sel.anchorNode.parentElement.closest('.entry');
    if (!entry || text.length < 3 || !entry.contains(sel.focusNode)) return hideTool();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    state.selection = { messageId: entry.id.slice(2), memberId: entry.dataset.author, text: text.length > 280 ? text.slice(0, 277) + '…' : text };
    hideTool();
    tool.hidden = false;
    const w = tool.offsetWidth;
    tool.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2 + scrollX))}px`;
    tool.style.top = `${rect.top + scrollY - tool.offsetHeight - 10}px`;
  }
  document.addEventListener('mouseup', e => { if (!tool.contains(e.target)) setTimeout(onSelect, 0); });
  document.addEventListener('keyup', e => { if (e.shiftKey) onSelect(); });
  document.addEventListener('touchend', () => setTimeout(onSelect, 250));
  tool.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !state.selection) return;
    const sel = state.selection;
    if (b.dataset.act === 'critique') {
      const pick = tool.querySelector('.seltool-pick');
      pick.innerHTML = room.members.filter(m => m.id !== sel.memberId)
        .map(m => `<button type="button" data-ask="${m.id}" title="Nhờ ${esc(m.name)} phản biện">${mono(m)}${esc(m.name)}</button>`).join('');
      tool.querySelector('.seltool-main').hidden = true;
      pick.hidden = false;
      pick.querySelector('button').focus();
    } else if (b.dataset.act === 'note') {
      const list = state.notes.get(sel.messageId) || [];
      const n = { id: `n${Date.now()}`, text: '' };
      list.push(n);
      state.notes.set(sel.messageId, list);
      renderMargin(sel.messageId);
      const margin = entries.get(sel.messageId).querySelector('.margin');
      margin.classList.add('is-open');
      margin.querySelector(`[data-note="${n.id}"]`).focus();
      hideTool();
      getSelection().removeAllRanges();
    } else if (b.dataset.ask) {
      state.quote = { messageId: sel.messageId, memberId: sel.memberId, text: sel.text };
      setRecipients(new Set([b.dataset.ask]));
      $('#composer-text').value = `@${nameOf(b.dataset.ask)} phản biện đoạn này giúp tôi. `;
      renderComposerQuote();
      hideTool();
      getSelection().removeAllRanges();
      focusComposer();
    }
  });
  document.addEventListener('focusout', e => {
    const n = e.target.closest?.('[data-note]');
    if (!n) return;
    const list = state.notes.get(n.dataset.msg) || [];
    const item = list.find(x => x.id === n.dataset.note);
    if (item) item.text = n.textContent.trim();
    if (item && !item.text) { state.notes.set(n.dataset.msg, list.filter(x => x !== item)); renderMargin(n.dataset.msg); }
  });

  // ---------- index drawer + keyboard ----------
  function closeIndex() { $('#index').classList.remove('is-open'); }
  $('[data-open-index]').onclick = () => { $('#index').classList.add('is-open'); $('#index button').focus(); };
  $('[data-close-index]').onclick = closeIndex;
  $('#toc').addEventListener('click', closeIndex);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideTool(); closeIndex(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea/i.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === '/') { e.preventDefault(); focusComposer(); }
    else if (e.key === 'v' || e.key === 'V') setView(state.view === 'case' ? 'args' : 'case');
    else if (e.key === 'j' || e.key === 'k') {
      setView('case');
      const list = [...entries.values()].filter(x => !x.hidden);
      let i = list.indexOf(document.activeElement);
      if (i < 0) i = list.findIndex(x => x.getBoundingClientRect().top > 8) - (e.key === 'j' ? 1 : 0);
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'j' ? 1 : -1)))];
      if (next) { next.scrollIntoView({ block: 'start' }); next.focus({ preventScroll: true }); }
    }
  });

  // ---------- wire the room ----------
  room.on('message', ({ message: msg }) => {
    if (msg.author === 'user') { ensureRound(msg); return; }
    if (msg.status === 'done') {
      if (entries.has(msg.id)) return;
      const d = drafts.get(msg.id);
      const tray = d?.parentElement;
      d?.remove();
      drafts.delete(msg.id);
      countDrafts(tray);
      fileEntry(msg, true);
      refreshLinks();
    } else upsertDraft(msg);
  });
  room.on('member', renderStatuses);
  room.on('activity', renderLog);
  room.on('disagreement', d => { state.newDisputes.add(d.id); refreshLinks(); });

  for (const msg of room.messages) msg.author === 'user' ? ensureRound(msg) : fileEntry(msg, false);
  setRecipients(new Set(allIds));
  refreshLinks();
  renderLog();
  renderMeta();
  setInterval(tickDrafts, 250);
  tickDrafts();
  setTimeout(() => room.start(), 900);
})();
