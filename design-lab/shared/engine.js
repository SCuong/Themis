// Mock room runtime shared by the three prototypes. It plays mock-data.js on a simulated clock:
// replies wait, stream word by word, finish or fail, exactly the four signals real Themis has.
// Nothing here touches a network. Usage: const room = ThemisMock.createRoom(); room.on('message', ...); room.start();
(function () {
  const D = window.THEMIS_MOCK_DATA;

  // ---------- tiny markdown (paragraphs, lists, checklists, fences, **bold**, *em*, `code`, @mentions) ----------
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(“"])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)@([\p{L}]+)/gu, '$1<span class="mention">@$2</span>');

  function md(text) {
    // Close dangling markers while a reply is still streaming, so half a word never shows raw "**".
    let t = text;
    if ((t.match(/\*\*/g) || []).length % 2) t += '**';
    const lines = t.split('\n');
    const out = [];
    let list = null, para = [], fence = null;
    const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
    const flushList = () => { if (list) out.push(`<${list.tag}${list.check ? ' class="checklist"' : ''}>${list.items.join('')}</${list.tag}>`); list = null; };
    for (const line of lines) {
      if (fence) {
        if (/^```/.test(line)) { out.push(`<pre data-lang="${esc(fence.lang)}"><code>${esc(fence.body.join('\n'))}</code></pre>`); fence = null; }
        else fence.body.push(line);
        continue;
      }
      const f = line.match(/^```(\w*)/);
      if (f) { flushPara(); flushList(); fence = { lang: f[1] || 'text', body: [] }; continue; }
      const check = line.match(/^- \[( |x)\] (.*)/);
      const bullet = line.match(/^- (.*)/);
      const num = line.match(/^\d+\. (.*)/);
      if (check || bullet || num) {
        flushPara();
        const tag = num ? 'ol' : 'ul';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [], check: !!check }; }
        list.items.push(check
          ? `<li class="${check[1] === 'x' ? 'is-checked' : ''}"><span class="box" aria-hidden="true"></span>${inline(check[2])}</li>`
          : `<li>${inline((bullet || num)[1])}</li>`);
        continue;
      }
      if (!line.trim()) { flushPara(); flushList(); continue; }
      flushList();
      para.push(line);
    }
    if (fence) out.push(`<pre data-lang="${esc(fence.lang)}"><code>${esc(fence.body.join('\n'))}</code></pre>`);
    flushPara(); flushList();
    return out.join('');
  }

  const pad = n => String(n).padStart(2, '0');
  const fmtClock = epoch => { const d = new Date(epoch); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDuration = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

  function createRoom({ speed = Number(new URLSearchParams(location.search).get('speed')) || 1 } = {}) {
    const startEpoch = Date.now();
    let vt = 0, rate = speed, paused = false, last = performance.now();
    let seq = 0;
    const tasks = [];
    const streams = new Map();
    const handlers = {};
    const emit = (type, payload) => (handlers[type] || []).forEach(fn => fn(payload));
    const now = () => startEpoch + vt;
    const at = (delayMs, fn) => tasks.push({ at: vt + delayMs, fn });

    const members = D.members.map(m => ({ ...m, status: 'idle', messageId: null, lastActiveAt: null }));
    const member = id => members.find(m => m.id === id);
    const historyBase = startEpoch - 46 * 60000;
    const messages = D.history.map(h => {
      const t = historyBase + h.minute * 60000;
      return { ...h, fullText: h.text, status: 'done', at: t, firstAt: t + (h.thinkMs || 0), doneAt: t + (h.totalMs || 0) };
    });
    const message = id => messages.find(m => m.id === id);
    const disagreements = D.disagreements.map(d => ({ ...d, at: historyBase + 22 * 60000 }));
    const activity = [];

    function log(kind, memberId, messageId, text) {
      const item = { id: `a${++seq}`, at: now(), kind, memberId, messageId, text };
      activity.push(item);
      emit('activity', item);
    }
    function setMember(id, status, messageId) {
      const m = member(id);
      Object.assign(m, { status, lastActiveAt: now() }, messageId ? { messageId } : {});
      emit('member', m);
    }
    function addMessage(msg) {
      messages.push(msg);
      emit('message', { kind: 'add', message: msg });
      return msg;
    }
    const update = msg => emit('message', { kind: 'update', message: msg });

    function beginStream(msg, wps, onDone) {
      msg.status = 'streaming';
      msg.firstAt = now();
      msg.text = '';
      streams.set(msg.id, { tokens: msg.fullText.match(/\S+\s*/g) || [], wps, startVt: vt, shown: 0, onDone });
      setMember(msg.author, 'streaming', msg.id);
      log('streaming', msg.author, msg.id, 'bắt đầu trả lời');
      update(msg);
    }

    // spec: { delay, wps, text, error?, retry?, quote?, replyTo? }
    function startReply(memberId, spec, round, onDone) {
      const msg = addMessage({
        id: `m${++seq}`, author: memberId, round, text: '', fullText: spec.text, status: 'waiting',
        at: now(), firstAt: null, doneAt: null, quote: spec.quote || null, replyTo: spec.replyTo || null, retrySpec: spec.retry || null,
      });
      setMember(memberId, 'waiting', msg.id);
      if (spec.error) {
        at(spec.error.at, () => {
          msg.status = 'error';
          msg.error = spec.error.text;
          msg.doneAt = now();
          setMember(memberId, 'error', msg.id);
          log('error', memberId, msg.id, spec.error.text);
          update(msg);
          onDone && onDone(msg); // a failure settles the round too, so the follow-up never waits on a retry
        });
      } else {
        at(spec.delay, () => beginStream(msg, spec.wps, onDone));
      }
      msg.onDone = onDone;
      return msg;
    }

    function tick() {
      const t = performance.now();
      if (!paused) vt += (t - last) * rate;
      last = t;
      tasks.sort((a, b) => a.at - b.at);
      while (tasks.length && tasks[0].at <= vt) tasks.shift().fn();
      for (const [id, s] of streams) {
        const msg = message(id);
        const shown = Math.min(s.tokens.length, Math.floor(((vt - s.startVt) / 1000) * s.wps) + 1);
        if (shown !== s.shown) {
          s.shown = shown;
          msg.text = s.tokens.slice(0, shown).join('');
          update(msg);
        }
        if (shown >= s.tokens.length) {
          streams.delete(id);
          msg.status = 'done';
          msg.text = msg.fullText;
          msg.doneAt = now();
          setMember(msg.author, 'done', msg.id);
          log('done', msg.author, msg.id, 'đã trả lời xong');
          update(msg);
          s.onDone && s.onDone(msg);
        }
      }
      emit('tick', now());
    }
    setInterval(tick, 50);

    function start() {
      const L = D.liveRound;
      addMessage({ ...L.prompt, fullText: L.prompt.text, status: 'done', at: now(), firstAt: now(), doneAt: now() });
      log('user', 'user', L.prompt.id, 'đã gửi câu hỏi cho cả nhóm');
      let left = L.replies.length;
      const oneDone = () => {
        if (--left) return;
        const F = L.followUp;
        at(F.at, () => {
          log('followup', F.memberId, null, `trả lời tiếp ${member(F.replyTo).name}`);
          startReply(F.memberId, F, 3, () => {
            const d = { ...F.disagreement, at: now() };
            disagreements.push(d);
            emit('disagreement', d);
            log('disagreement', F.memberId, null, `bất đồng mới: ${d.topic}`);
          });
        });
      };
      L.replies.forEach(r => startReply(r.memberId, r, 3, oneDone));
    }

    function retry(memberId) {
      const msg = [...messages].reverse().find(m => m.author === memberId && m.status === 'error');
      if (!msg) return false;
      const spec = msg.retrySpec || { delay: 2000, wps: 12 };
      msg.status = 'waiting';
      msg.error = null;
      msg.at = now();
      setMember(memberId, 'waiting', msg.id);
      log('retry', memberId, msg.id, 'đang thử gửi lại');
      update(msg);
      at(spec.delay, () => beginStream(msg, spec.wps, msg.onDone));
      return true;
    }

    // Targets: "@all" or no mention → everyone; otherwise every member whose name is mentioned.
    function targetsOf(text) {
      if (/@all\b/i.test(text)) return members.map(m => m.id);
      const f = fold(text);
      const named = members.filter(m => f.includes('@' + fold(m.name))).map(m => m.id);
      return named.length ? named : members.map(m => m.id);
    }

    function send({ text, to, quote } = {}) {
      const clean = (text || '').trim();
      if (!clean) return null;
      const targets = to || targetsOf(clean);
      const round = Math.max(...messages.map(m => m.round || 0)) + 1;
      const userMsg = addMessage({ id: `u${++seq}`, author: 'user', round, to: targets, text: clean, fullText: clean, quote: quote || null, status: 'done', at: now(), firstAt: now(), doneAt: now() });
      log('user', 'user', userMsg.id, `đã gửi cho ${targets.length === members.length ? 'cả nhóm' : targets.map(id => member(id).name).join(', ')}`);
      const about = quote ? quote.text : clean.replace(/@\S+\s*/g, '');
      const q = about.slice(0, 48) + (about.length > 48 ? '…' : '');
      targets.forEach((id, i) => startReply(id, {
        delay: 1400 + i * 1700 + (id.charCodeAt(0) % 5) * 400, wps: 11 + (i % 3) * 2,
        text: D.cannedReplies[id].replace('{q}', q), quote: quote || null,
      }, round));
      return userMsg;
    }

    function on(type, fn) {
      (handlers[type] ||= []).push(fn);
      return () => { handlers[type] = handlers[type].filter(h => h !== fn); };
    }

    return {
      room: D.room, members, messages, disagreements, activity,
      member, message, on, start, send, retry, now,
      addDisagreement(d) { const x = { id: `d${++seq}`, status: 'open', at: now(), ...d }; disagreements.push(x); emit('disagreement', x); return x; },
      setSpeed(n) { rate = n; emit('clock', { speed: rate, paused }); },
      pause() { paused = true; emit('clock', { speed: rate, paused }); },
      resume() { paused = false; last = performance.now(); emit('clock', { speed: rate, paused }); },
      get speed() { return rate; },
      get paused() { return paused; },
      get startedAt() { return startEpoch; },
    };
  }

  window.ThemisMock = { data: D, createRoom, md, esc, fmtClock, fmtDuration };
})();
