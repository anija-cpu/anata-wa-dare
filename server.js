const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- 人物データ ----------
// public/images/person/01.jpg 〜 96.jpg を読み込む
function buildPersonDeck() {
  const deck = [];
  for (let i = 1; i <= 96; i++) {
    deck.push({
      id: 'p' + i,
      url: `/images/person/${String(i).padStart(2, '0')}.jpg`
    });
  }
  return deck;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 人数に応じた候補人数(4人までは5枚、以降1人増えるごとに+1枚)
function numCandidatesFor(playerCount) {
  return 5 + Math.max(0, playerCount - 4);
}

// ---------- ルーム管理 ----------
const rooms = new Map(); // code -> roomState

function makeRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createRoom(hostSocketId, hostName) {
  const code = makeRoomCode();
  const room = {
    code,
    hostId: hostSocketId,
    players: [{ id: hostSocketId, name: hostName, score: 0, connected: true }],
    phase: 'lobby',
    playOrder: [],
    roundIndex: 0,
    life: null,
    outcome: null, // 'win' | 'lose'
    personDeck: shuffle(buildPersonDeck()),
    personDrawPtr: 0,
    round: null
  };
  rooms.set(code, room);
  return room;
}

function resetRoomForRestart(room) {
  room.players.forEach(p => { p.score = 0; });
  room.phase = 'lobby';
  room.playOrder = [];
  room.roundIndex = 0;
  room.life = null;
  room.outcome = null;
  room.round = null;
}

function drawPersonCards(room, n) {
  const drawn = [];
  for (let i = 0; i < n; i++) {
    if (room.personDrawPtr >= room.personDeck.length) {
      room.personDeck = shuffle(room.personDeck);
      room.personDrawPtr = 0;
    }
    drawn.push(room.personDeck[room.personDrawPtr]);
    room.personDrawPtr++;
  }
  return drawn;
}

function connectedPlayers(room) {
  return room.players.filter(p => p.connected);
}

function publicPlayers(room) {
  return room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }));
}

function startRound(room) {
  const order = room.playOrder;
  const parentId = order[room.roundIndex % order.length];
  const childIds = connectedPlayers(room).map(p => p.id).filter(id => id !== parentId);
  const playerCount = connectedPlayers(room).length;

  const answerCard = drawPersonCards(room, 1)[0];
  // ヒントはプレイヤー数-1(親以外全員が1問ずつ、感じたことを自由記述)
  const numAssignments = childIds.length;

  const assignments = [];
  if (childIds.length > 0) {
    const offset = room.roundIndex % childIds.length;
    for (let i = 0; i < numAssignments; i++) {
      const childId = childIds[(offset + i) % childIds.length];
      assignments.push({
        index: i,
        childId,
        text: null,
        revealed: false
      });
    }
  }

  room.round = {
    parentId,
    childIds,
    answerCard,
    assignments,
    numCandidates: numCandidatesFor(playerCount),
    candidates: null,
    guess: null
  };
  room.phase = 'writing';
}

function allAssignmentsSubmitted(round) {
  return round.assignments.every(a => a.text !== null);
}

function allAssignmentsRevealed(round) {
  return round.assignments.every(a => a.revealed);
}

function beginGuessingPhase(room) {
  const round = room.round;
  const decoysNeeded = Math.max(0, round.numCandidates - 1);
  const decoys = drawPersonCards(room, decoysNeeded);
  const all = shuffle([round.answerCard, ...decoys]);
  round.candidates = all.map(c => ({ id: c.id, url: c.url, isAnswer: c.id === round.answerCard.id }));
  // ヒントはボタン操作不要で最初から全公開
  round.assignments.forEach(a => { a.revealed = true; });
  room.phase = 'reveal';
}

// クライアントへ送るための、親には答えを隠したラウンド情報を生成
function roundViewFor(room, socketId) {
  if (!room.round) return null;
  const round = room.round;
  const isParent = socketId === round.parentId && room.phase !== 'round_result';
  return {
    parentId: round.parentId,
    childIds: round.childIds,
    answerCard: isParent ? undefined : round.answerCard,
    assignments: round.assignments.map(a => ({
      index: a.index,
      childId: a.childId,
      text: (a.revealed || a.childId === socketId) ? a.text : null,
      submitted: a.text !== null,
      revealed: a.revealed
    })),
    candidates: round.candidates
      ? round.candidates.map(c => ({ id: c.id, url: c.url, isAnswer: isParent ? undefined : c.isAnswer }))
      : null,
    guess: round.guess
  };
}

function broadcastState(room) {
  for (const p of room.players) {
    if (!p.connected) continue;
    io.to(p.id).emit('game_state', {
      code: room.code,
      hostId: room.hostId,
      phase: room.phase,
      players: publicPlayers(room),
      roundIndex: room.roundIndex,
      totalRounds: room.playOrder.length,
      life: room.life,
      outcome: room.outcome,
      round: roundViewFor(room, p.id),
      you: p.id
    });
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name }) => {
    const room = createRoom(socket.id, (name || '').trim() || 'ホスト');
    socket.join(room.code);
    socket.data.roomCode = room.code;
    broadcastState(room);
  });

  socket.on('search_rooms', ({ query }) => {
    const q = (query || '').trim().toUpperCase();
    const results = [];
    for (const room of rooms.values()) {
      if (room.phase !== 'lobby') continue;
      const host = room.players.find(p => p.id === room.hostId);
      const hostName = host ? host.name : '';
      if (q && !room.code.includes(q) && !hostName.toUpperCase().includes(q)) continue;
      results.push({
        code: room.code,
        hostName,
        playerCount: connectedPlayers(room).length
      });
      if (results.length >= 20) break;
    }
    socket.emit('room_search_results', results);
  });

  socket.on('join_room', ({ code, name }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room) {
      socket.emit('error_message', 'その部屋コードは見つかりませんでした。');
      return;
    }
    if (room.phase !== 'lobby') {
      socket.emit('error_message', 'このゲームはすでに開始されています。');
      return;
    }
    room.players.push({ id: socket.id, name: (name || '').trim() || 'プレイヤー', score: 0, connected: true });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    broadcastState(room);
  });

  socket.on('start_game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    const players = connectedPlayers(room);
    if (players.length < 3) {
      socket.emit('error_message', '最低3人集まってから開始してください。');
      return;
    }
    room.playOrder = shuffle(players.map(p => p.id));
    room.roundIndex = 0;
    room.life = Math.ceil(players.length / 2);
    room.outcome = null;
    startRound(room);
    broadcastState(room);
  });

  socket.on('submit_profile', ({ index, text }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.round || room.phase !== 'writing') return;
    const a = room.round.assignments.find(a => a.index === index && a.childId === socket.id);
    if (!a || a.text !== null) return;
    a.text = (text || '').trim().slice(0, 60) || '(無回答)';
    if (allAssignmentsSubmitted(room.round)) {
      beginGuessingPhase(room);
    }
    broadcastState(room);
  });

  socket.on('send_stamp', ({ type, value }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    let safeType = 'emoji';
    let safeValue = '👍';
    if (type === 'image' && typeof value === 'string' && /^\/images\/stamps\/[\w\-.]+\.(png|jpg|jpeg|gif|webp)$/i.test(value)) {
      safeType = 'image';
      safeValue = value;
    } else if (typeof value === 'string' && value.trim()) {
      safeType = 'emoji';
      safeValue = value.slice(0, 4);
    }
    io.to(room.code).emit('stamp_broadcast', { playerName: player.name, type: safeType, value: safeValue });
  });

  // 共有らくがき: 記入フェーズの子プレイヤー同士でリアルタイム共有する
  socket.on('doodle_draw', (seg) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.round || room.phase !== 'writing') return;
    if (!room.round.childIds.includes(socket.id)) return;
    if (!seg || typeof seg !== 'object') return;

    const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
    const x0 = num(seg.x0), y0 = num(seg.y0), x1 = num(seg.x1), y1 = num(seg.y1);
    if (x0 === null || y0 === null || x1 === null || y1 === null) return;

    const tool = seg.tool === 'eraser' ? 'eraser' : 'pen';
    const color = typeof seg.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(seg.color) ? seg.color : '#c1443c';
    const size = typeof seg.size === 'number' && isFinite(seg.size) ? Math.max(1, Math.min(30, seg.size)) : 4;

    // 自分以外の同ラウンドの子プレイヤーへ中継(自分の画面は送信元ですでに描画済み)
    room.round.childIds.forEach(childId => {
      if (childId === socket.id) return;
      io.to(childId).emit('doodle_draw', { x0, y0, x1, y1, tool, color, size });
    });
  });

  socket.on('submit_guess', ({ cardId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.round || room.phase !== 'reveal') return;
    if (socket.id !== room.round.parentId) return;
    if (!allAssignmentsRevealed(room.round)) return;
    const chosen = room.round.candidates.find(c => c.id === cardId);
    if (!chosen) return;
    const correct = chosen.isAnswer;
    if (correct) {
      const parent = room.players.find(p => p.id === socket.id);
      if (parent) parent.score += 1;
    } else if (room.life !== null) {
      room.life = Math.max(0, room.life - 1);
    }
    room.round.guess = { cardId, correct };
    room.phase = 'round_result';
    broadcastState(room);
  });

  socket.on('next_round', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.phase !== 'round_result') return;

    if (room.life !== null && room.life <= 0) {
      room.phase = 'gameover';
      room.outcome = 'lose';
      room.round = null;
      broadcastState(room);
      return;
    }

    room.roundIndex += 1;
    if (room.roundIndex >= room.playOrder.length) {
      room.phase = 'gameover';
      room.outcome = 'win';
      room.round = null;
    } else {
      startRound(room);
    }
    broadcastState(room);
  });

  socket.on('restart_game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.phase !== 'gameover') return;
    resetRoomForRestart(room);
    broadcastState(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;
    if (room.players.every(p => !p.connected)) {
      rooms.delete(code);
      return;
    }
    broadcastState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`あなたはだーれ サーバー起動: http://localhost:${PORT}`);
});
