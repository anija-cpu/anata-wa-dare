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
  const childIdxs = [0, 1, 2].filter(i => sockets[i].id !== parentId);
  const [childA, childB] = childIdxs;

  let receivedByChildB = null;
  let receivedByParent = null;
  sockets[childB].on('doodle_draw', seg => { receivedByChildB = seg; });
  sockets[parentId === sockets[0].id ? 0 : (parentId === sockets[1].id ? 1 : 2)]
    .on('doodle_draw', seg => { receivedByParent = seg; });

  sockets[childA].emit('doodle_draw', { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2, tool: 'pen', color: '#c1443c', size: 4 });
  await wait(500);

  console.log('childB received:', JSON.stringify(receivedByChildB));
  console.log('parent received (should be null):', receivedByParent);

  sockets.forEach(s => s.close());
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
