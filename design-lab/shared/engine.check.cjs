// Self-check: run the shared engine at 20x speed and assert the live round settles as designed.
global.window = global; global.location = { search: '' }; global.performance = require('perf_hooks').performance;
require(__dirname + "/.." + '/shared/mock-data.js'); require(__dirname + "/.." + '/shared/engine.js');
const assert = require('assert');
const room = ThemisMock.createRoom({ speed: 20 });
const kinds = []; room.on('activity', a => kinds.push(`${a.kind}:${a.memberId}`));
let d3 = false; room.on('disagreement', d => { d3 = d.id === 'd3'; });
room.start();
setTimeout(() => {
  assert(room.member('van').status === 'error', 'van should fail');
  assert(room.retry('van'), 'retry should find the failed message');
}, 400);
setTimeout(() => {
  assert(['linh','khoa','mai','rook','van'].every(id => room.member(id).status === 'done'), JSON.stringify(room.members.map(m => m.status)));
  assert(d3, 'follow-up should open d3');
  assert(room.messages.filter(m => m.round === 3).every(m => m.status === 'done' && m.text === m.fullText));
  const u = room.send({ text: '@Vân @rook thử composer' });
  assert.deepStrictEqual(u.to, ['rook', 'van']);
  assert(ThemisMock.md('- [ ] a `x`\n\n```ts\nconst a=1\n```').includes('<pre data-lang="ts">'));
  console.log('ok', kinds.length, 'activity items'); process.exit(0);
}, 4500);
