const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(cond, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (cond()) return true; await wait(50); }
  throw new Error('timeout');
}

(async () => {
  const names = ['A', 'B', 'C'];
  const sockets = names.map(() => io(URL, { transports: ['websocket'] }));
  let states = [null, null, null];
  sockets.forEach((s, i) => s.on('game_state', st => states[i] = st));

  await wait(300);
  sockets[0].emit('create_room', { name: names[0] });
  await waitFor(() => states[0]);
  const code = states[0].code;
  sockets[1].emit('join_room', { name: names[1], code });
  sockets[2].emit('join_room', { name: names[2], code });
  await waitFor(() => states[0].players.length === 3);
  sockets[0].emit('start_game');
  await waitFor(() => states[0].phase === 'writing');

  const parentId = states[0].round.parentId;
  const childIdx = [0, 1, 2].find(i => sockets[i].id !== parentId);

  // 落書きを2本描く
  sockets[childIdx].emit('doodle_draw', { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2, tool: 'pen', color: '#c1443c', size: 4 });
  sockets[childIdx].emit('doodle_draw', { x0: 0.3, y0: 0.3, x1: 0.4, y1: 0.4, tool: 'eraser', color: '#c1443c', size: 6 });
  await wait(300);

  // 全員submit
  for (let i = 0; i < 3; i++) {
    const mine = states[i].round.assignments.filter(a => a.childId === sockets[i].id && !a.submitted);
    for (const a of mine) sockets[i].emit('submit_profile', { index: a.index, text: 'x' });
  }
  await waitFor(() => states[0].phase === 'reveal');

  const parentIdx = [0, 1, 2].find(i => sockets[i].id === parentId);
  const candidate = states[parentIdx].round.candidates[0];
  sockets[parentIdx].emit('submit_guess', { cardId: candidate.id });
  await waitFor(() => states[0].phase === 'round_result');

  console.log('doodleSegments件数(親視点):', states[parentIdx].round.doodleSegments ? states[parentIdx].round.doodleSegments.length : 'undefined');
  console.log('doodleSegments件数(子視点):', states[childIdx].round.doodleSegments ? states[childIdx].round.doodleSegments.length : 'undefined');
  console.log('中身:', JSON.stringify(states[parentIdx].round.doodleSegments));

  sockets.forEach(s => s.close());
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
