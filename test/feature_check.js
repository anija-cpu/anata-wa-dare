const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(cond, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (cond()) return true;
    await wait(50);
  }
  throw new Error('timeout');
}

(async () => {
  // ---- 5人プレイで候補数が6枚になるか確認 ----
  const names5 = ['A', 'B', 'C', 'D', 'E'];
  const sockets5 = names5.map(() => io(URL, { transports: ['websocket'] }));
  let states5 = [null, null, null, null, null];
  sockets5.forEach((s, i) => s.on('game_state', st => states5[i] = st));

  await wait(300);
  sockets5[0].emit('create_room', { name: names5[0] });
  await waitFor(() => states5[0]);
  const code5 = states5[0].code;
  for (let i = 1; i < 5; i++) sockets5[i].emit('join_room', { name: names5[i], code: code5 });
  await waitFor(() => states5[0].players.length === 5);

  sockets5[0].emit('start_game');
  await waitFor(() => states5[0].phase === 'writing');
  console.log('5人プレイ開始 life=', states5[0].life, '(期待値 3)');

  // 全員submit
  for (let i = 0; i < 5; i++) {
    const mine = states5[i].round.assignments.filter(a => a.childId === sockets5[i].id && !a.submitted);
    for (const a of mine) sockets5[i].emit('submit_profile', { index: a.index, text: 'x' });
  }
  await waitFor(() => states5[0].phase === 'reveal');
  console.log('候補数=', states5[0].round.candidates.length, '(期待値 6)');
  console.log('ヒント数=', states5[0].round.assignments.length, '(期待値 4=5人-1)');

  sockets5.forEach(s => s.close());

  // ---- 部屋検索 ----
  const hostS = io(URL, { transports: ['websocket'] });
  let hostState = null;
  hostS.on('game_state', st => hostState = st);
  await wait(200);
  hostS.emit('create_room', { name: 'けんさくホスト' });
  await waitFor(() => hostState);
  const searchCode = hostState.code;

  const searcherS = io(URL, { transports: ['websocket'] });
  let searchResults = null;
  searcherS.on('room_search_results', r => searchResults = r);
  await wait(200);
  searcherS.emit('search_rooms', { query: 'けんさく' });
  await waitFor(() => searchResults !== null);
  console.log('検索結果:', JSON.stringify(searchResults));
  const found = searchResults.find(r => r.code === searchCode);
  console.log('検索で見つかった:', !!found);

  hostS.close();
  searcherS.close();

  // ---- 再戦(restart_game) ----
  const names3 = ['X', 'Y', 'Z'];
  const sockets3 = names3.map(() => io(URL, { transports: ['websocket'] }));
  let states3 = [null, null, null];
  sockets3.forEach((s, i) => s.on('game_state', st => states3[i] = st));
  await wait(300);
  sockets3[0].emit('create_room', { name: names3[0] });
  await waitFor(() => states3[0]);
  const code3 = states3[0].code;
  sockets3[1].emit('join_room', { name: names3[1], code: code3 });
  sockets3[2].emit('join_room', { name: names3[2], code: code3 });
  await waitFor(() => states3[0].players.length === 3);
  sockets3[0].emit('start_game');
  await waitFor(() => states3[0].phase === 'writing');

  // 強制的にゲームオーバーまで回す(常に失敗する候補を選び続ける)
  let guard = 0;
  while (states3[0].phase !== 'gameover' && guard < 10) {
    guard++;
    const st = states3[0];
    for (let i = 0; i < 3; i++) {
      const mine = states3[i].round ? states3[i].round.assignments.filter(a => a.childId === sockets3[i].id && !a.submitted) : [];
      for (const a of mine) sockets3[i].emit('submit_profile', { index: a.index, text: 'x' });
    }
    await waitFor(() => states3[0].phase === 'reveal', 3000);
    for (let i = 0; i < 3; i++) {
      const mine = states3[i].round.assignments.filter(a => a.childId === sockets3[i].id && !a.revealed);
      for (const a of mine) { sockets3[i].emit('reveal_profile', { index: a.index }); await wait(20); }
    }
    await waitFor(() => states3[0].round.assignments.every(a => a.revealed), 3000);
    const parentIdx = [sockets3[0].id, sockets3[1].id, sockets3[2].id].indexOf(states3[0].round.parentId);
    // わざと不正解の候補を選ぶ
    const wrongCandidate = states3[parentIdx].round.candidates.find(c => !c.isAnswer) || states3[parentIdx].round.candidates[0];
    sockets3[parentIdx].emit('submit_guess', { cardId: wrongCandidate.id });
    await waitFor(() => states3[0].phase === 'round_result', 3000);
    const hostIdx = [sockets3[0].id, sockets3[1].id, sockets3[2].id].indexOf(states3[0].hostId);
    sockets3[hostIdx].emit('next_round');
    await waitFor(() => states3[0].phase === 'writing' || states3[0].phase === 'gameover', 3000);
  }
  console.log('ゲーム終了 outcome=', states3[0].outcome, 'life=', states3[0].life);

  const hostIdx3 = [sockets3[0].id, sockets3[1].id, sockets3[2].id].indexOf(states3[0].hostId);
  sockets3[hostIdx3].emit('restart_game');
  await waitFor(() => states3[0].phase === 'lobby');
  console.log('再戦後 phase=', states3[0].phase, 'scores=', states3[0].players.map(p => p.score));

  sockets3.forEach(s => s.close());
  process.exit(0);
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
