const { io } = require('socket.io-client');

const URL = 'http://localhost:3000';
const names = ['アリス', 'ボブ', 'キャロル'];
const sockets = names.map(() => io(URL, { transports: ['websocket'] }));
let states = [null, null, null];
let roomCode = null;

function log(...args) { console.log(...args); }

sockets.forEach((s, i) => {
  s.on('game_state', (state) => {
    states[i] = state;
  });
  s.on('error_message', (msg) => log('ERROR', i, msg));
  s.on('connect_error', (e) => log('CONNECT ERROR', i, e.message));
});

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(cond, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return true;
    await wait(50);
  }
  throw new Error('timeout waiting for condition');
}

(async () => {
  await wait(300);
  sockets[0].emit('create_room', { name: names[0] });
  await waitFor(() => states[0] && states[0].code);
  roomCode = states[0].code;
  log('room code:', roomCode);

  sockets[1].emit('join_room', { name: names[1], code: roomCode });
  sockets[2].emit('join_room', { name: names[2], code: roomCode });
  await waitFor(() => states[0] && states[0].players.length === 3);
  log('lobby players ok');

  sockets[0].emit('start_game');
  await waitFor(() => states[0].phase === 'writing');
  log('game started, phase=writing');

  let rounds = 0;
  while (states[0].phase !== 'gameover' && rounds < 5) {
    rounds++;
    const st = states[0];
    const parentId = st.round.parentId;
    log('--- round', st.roundIndex + 1, 'parent=', parentId === sockets[0].id ? names[0] : (parentId === sockets[1].id ? names[1] : names[2]));
    log('  assignments per child:', st.round.assignments.map(a => a.childId));

    // 全員のstateから自分の担当assignmentを見つけてsubmit
    for (let i = 0; i < 3; i++) {
      const mySocket = sockets[i];
      const myState = states[i];
      if (!myState.round) continue;
      const mine = myState.round.assignments.filter(a => a.childId === mySocket.id && !a.submitted);
      for (const a of mine) {
        mySocket.emit('submit_profile', { index: a.index, text: `テスト回答${a.index}` });
      }
    }

    await waitFor(() => states[0].phase === 'reveal', 3000);
    log('  -> reveal phase reached');

    // 各子がreveal
    for (let i = 0; i < 3; i++) {
      const mySocket = sockets[i];
      const myState = states[i];
      const mine = myState.round.assignments.filter(a => a.childId === mySocket.id && !a.revealed);
      for (const a of mine) {
        mySocket.emit('reveal_profile', { index: a.index });
        await wait(30);
      }
    }

    await waitFor(() => states[0].round.assignments.every(a => a.revealed), 3000);
    log('  -> all revealed');

    // 親がguess
    const parentIdx = [sockets[0].id, sockets[1].id, sockets[2].id].indexOf(states[0].round.parentId);
    const parentState = states[parentIdx];
    const candidate = parentState.round.candidates[0];
    sockets[parentIdx].emit('submit_guess', { cardId: candidate.id });

    await waitFor(() => states[0].phase === 'round_result', 3000);
    log('  -> result:', states[0].round.guess);

    // hostが次へ
    const hostIdx = [sockets[0].id, sockets[1].id, sockets[2].id].indexOf(states[0].hostId);
    sockets[hostIdx].emit('next_round');
    await waitFor(() => states[0].phase === 'writing' || states[0].phase === 'gameover', 3000);
  }

  log('FINAL phase:', states[0].phase);
  log('FINAL scores:', states[0].players.map(p => p.name + ':' + p.score));
  process.exit(0);
})().catch(e => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
