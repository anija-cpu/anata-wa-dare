const socket = io();

const screens = {
  join: document.getElementById('screen-join'),
  lobby: document.getElementById('screen-lobby'),
  writingChild: document.getElementById('screen-writing-child'),
  writingParent: document.getElementById('screen-writing-parent'),
  reveal: document.getElementById('screen-reveal'),
  result: document.getElementById('screen-result'),
  gameover: document.getElementById('screen-gameover'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

let latestState = null;

// 記入中のテキストを一時保存(他プレイヤーの操作で再描画されても入力内容が消えないように)
const draftTexts = {};

// スタンプの中身をここで定義。絵文字でも画像でもOK。
// 画像にする場合は public/images/stamps/ にファイルを置いて
// { type: 'image', value: '/images/stamps/ファイル名.png' } と書くだけ
const STAMP_ITEMS = [
  { type: 'emoji', value: '👀' },
  { type: 'emoji', value: '🤔' },
  { type: 'emoji', value: '😂' },
  { type: 'emoji', value: '🔥' },
  { type: 'emoji', value: '👍' },
  { type: 'emoji', value: '😅' },
  { type: 'emoji', value: '🤫' },
  { type: 'emoji', value: '❤️' },
];

// ---------- 落書き機能(人物写真へのみんなで共有らくがき) ----------
const doodleCanvas = document.getElementById('doodleCanvas');
const doodleCtx = doodleCanvas.getContext('2d');
const answerImg = document.getElementById('answerImg');
const doodleColorsBox = document.getElementById('doodleColors');
const doodleSizeSlider = document.getElementById('doodleSize');
const btnEraser = document.getElementById('btnEraser');

const DOODLE_COLORS = ['#2a2118', '#c1443c', '#e8a33d', '#4c7a4a', '#3b6ea5', '#7d5ba6', '#ffffff'];

let doodleDrawing = false;
let lastDoodleRoundKey = null;
let doodleLastPoint = null;
let doodleColor = DOODLE_COLORS[1];
let doodleSize = 4;
let doodleTool = 'pen'; // 'pen' | 'eraser'

// カラーパレットを生成
DOODLE_COLORS.forEach((color, i) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'doodle-color-btn';
  btn.style.background = color;
  if (i === 1) btn.classList.add('active');
  btn.addEventListener('click', () => {
    doodleColor = color;
    doodleTool = 'pen';
    updateDoodleToolUI();
  });
  doodleColorsBox.appendChild(btn);
});

function updateDoodleToolUI() {
  [...doodleColorsBox.children].forEach((btn, i) => {
    btn.classList.toggle('active', doodleTool === 'pen' && DOODLE_COLORS[i] === doodleColor);
  });
  btnEraser.classList.toggle('active', doodleTool === 'eraser');
}

doodleSizeSlider.addEventListener('input', () => {
  doodleSize = +doodleSizeSlider.value;
});

btnEraser.addEventListener('click', () => {
  doodleTool = doodleTool === 'eraser' ? 'pen' : 'eraser';
  updateDoodleToolUI();
});

function resizeDoodleCanvas() {
  const rect = answerImg.getBoundingClientRect();
  doodleCanvas.width = rect.width || 200;
  doodleCanvas.height = rect.height || 266;
}

function clearDoodle() {
  doodleCtx.clearRect(0, 0, doodleCanvas.width, doodleCanvas.height);
}

function doodlePos(e) {
  const rect = doodleCanvas.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  return { x: point.clientX - rect.left, y: point.clientY - rect.top };
}

function strokeSegment(x0, y0, x1, y1, tool, color, size) {
  doodleCtx.lineCap = 'round';
  doodleCtx.lineJoin = 'round';
  if (tool === 'eraser') {
    doodleCtx.globalCompositeOperation = 'destination-out';
    doodleCtx.lineWidth = size * 2.2;
  } else {
    doodleCtx.globalCompositeOperation = 'source-over';
    doodleCtx.strokeStyle = color;
    doodleCtx.lineWidth = size;
  }
  doodleCtx.beginPath();
  doodleCtx.moveTo(x0, y0);
  doodleCtx.lineTo(x1, y1);
  doodleCtx.stroke();
  doodleCtx.globalCompositeOperation = 'source-over';
}

function doodleStart(e) {
  doodleDrawing = true;
  doodleLastPoint = doodlePos(e);
  e.preventDefault();
}

function doodleMove(e) {
  if (!doodleDrawing) return;
  const p = doodlePos(e);
  const prev = doodleLastPoint;
  strokeSegment(prev.x, prev.y, p.x, p.y, doodleTool, doodleColor, doodleSize);
  doodleLastPoint = p;

  // 正規化座標(0〜1)にして他プレイヤーへ送信(画面サイズが違っても対応できるように)
  const w = doodleCanvas.width, h = doodleCanvas.height;
  socket.emit('doodle_draw', {
    x0: prev.x / w, y0: prev.y / h, x1: p.x / w, y1: p.y / h,
    tool: doodleTool, color: doodleColor, size: doodleSize
  });
  e.preventDefault();
}

function doodleEnd() {
  doodleDrawing = false;
  doodleLastPoint = null;
}

doodleCanvas.addEventListener('mousedown', doodleStart);
doodleCanvas.addEventListener('mousemove', doodleMove);
window.addEventListener('mouseup', doodleEnd);
doodleCanvas.addEventListener('touchstart', doodleStart, { passive: false });
doodleCanvas.addEventListener('touchmove', doodleMove, { passive: false });
doodleCanvas.addEventListener('touchend', doodleEnd);

// 他プレイヤーが描いた線を自分の画面にも反映
socket.on('doodle_draw', (seg) => {
  const w = doodleCanvas.width, h = doodleCanvas.height;
  strokeSegment(seg.x0 * w, seg.y0 * h, seg.x1 * w, seg.y1 * h, seg.tool, seg.color, seg.size);
});

answerImg.addEventListener('load', resizeDoodleCanvas);
window.addEventListener('resize', resizeDoodleCanvas);

// ---------- BGM ----------
const bgmAudio = document.getElementById('bgmAudio');
const btnMute = document.getElementById('btnMute');
const btnVolDown = document.getElementById('btnVolDown');
const btnVolUp = document.getElementById('btnVolUp');
const volumeSlider = document.getElementById('volumeSlider');
const volumeLabel = document.getElementById('volumeLabel');

const BGM_STORAGE_KEY = 'anataWaDare_bgm';

function loadBgmSettings() {
  try {
    const raw = localStorage.getItem(BGM_STORAGE_KEY);
    if (!raw) return { volume: 35, muted: false };
    const parsed = JSON.parse(raw);
    return {
      volume: typeof parsed.volume === 'number' ? parsed.volume : 35,
      muted: !!parsed.muted
    };
  } catch (e) {
    return { volume: 35, muted: false };
  }
}

function saveBgmSettings() {
  try {
    localStorage.setItem(BGM_STORAGE_KEY, JSON.stringify({ volume, muted: userMuted }));
  } catch (e) {
    // localStorageが使えない環境では保存をあきらめる
  }
}

const savedBgm = loadBgmSettings();
let volume = savedBgm.volume; // 0-100
let userMuted = savedBgm.muted;
let bgmStarted = false;

function applyVolume() {
  bgmAudio.volume = volume / 100;
  volumeSlider.value = volume;
  volumeLabel.textContent = volume + '%';
}

function setVolume(v) {
  volume = Math.max(0, Math.min(100, Math.round(v)));
  applyVolume();
  saveBgmSettings();
}

applyVolume();
bgmAudio.muted = userMuted;
btnMute.textContent = userMuted ? '🔇' : '🔊';
btnMute.classList.toggle('is-muted', userMuted);

volumeSlider.addEventListener('input', () => setVolume(+volumeSlider.value));
btnVolDown.addEventListener('click', () => setVolume(volume - 1));
btnVolUp.addEventListener('click', () => setVolume(volume + 1));

function tryStartBgm() {
  if (bgmStarted || userMuted) return;
  bgmAudio.play().then(() => { bgmStarted = true; }).catch(() => {
    // ブラウザの自動再生制限で失敗した場合は、次のクリックで再度試す
  });
}
// 最初のクリック/タップをきっかけに再生開始(自動再生制限への対応)
document.addEventListener('click', tryStartBgm, { once: true });

btnMute.addEventListener('click', () => {
  userMuted = !userMuted;
  bgmAudio.muted = userMuted;
  btnMute.textContent = userMuted ? '🔇' : '🔊';
  btnMute.classList.toggle('is-muted', userMuted);
  saveBgmSettings();
  if (!userMuted) tryStartBgm();
});

// ---------- 参加画面 ----------
document.getElementById('btnCreate').addEventListener('click', () => {
  const name = document.getElementById('createName').value;
  socket.emit('create_room', { name });
});

document.getElementById('btnJoin').addEventListener('click', () => {
  const name = document.getElementById('joinName').value;
  const code = document.getElementById('joinCode').value;
  if (!code.trim()) {
    showJoinError('部屋番号を入力してください。');
    return;
  }
  socket.emit('join_room', { name, code });
});

function showJoinError(msg) {
  const el = document.getElementById('joinError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

socket.on('error_message', (msg) => showJoinError(msg));

// ---------- 部屋検索 ----------
const btnSearchRooms = document.getElementById('btnSearchRooms');
if (btnSearchRooms) {
  btnSearchRooms.addEventListener('click', () => {
    btnSearchRooms.textContent = '検索中…';
    socket.emit('search_rooms', { query: '' });
  });
}

socket.on('room_search_results', (results) => {
  if (btnSearchRooms) btnSearchRooms.textContent = '🔍 待機中のルームを探す';
  const box = document.getElementById('roomSearchResults');
  if (!box) return;
  box.innerHTML = '';
  if (results.length === 0) {
    box.innerHTML = '<p class="hint">待機中のルームはありません。</p>';
    return;
  }
  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'room-result';
    item.innerHTML = `<span class="room-result-code">${r.code}</span>
      <span class="room-result-info">${r.hostName} の部屋・${r.playerCount}人待機中</span>`;
    item.addEventListener('click', () => {
      document.getElementById('joinCode').value = r.code;
      document.getElementById('joinName').focus();
    });
    box.appendChild(item);
  });
});

// ---------- ロビー ----------
document.getElementById('btnStart').addEventListener('click', () => {
  socket.emit('start_game');
});

// ---------- 結果／次ラウンド ----------
document.getElementById('btnNext').addEventListener('click', () => {
  socket.emit('next_round');
});

document.getElementById('btnRestart').addEventListener('click', () => {
  window.location.reload();
});

document.getElementById('btnPlayAgain').addEventListener('click', () => {
  socket.emit('restart_game');
});

// ---------- スタンプ機能 ----------
function buildStampBar(container) {
  container.innerHTML = '';
  STAMP_ITEMS.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stamp-btn';
    if (item.type === 'image') {
      btn.innerHTML = `<img src="${item.value}" alt="スタンプ">`;
    } else {
      btn.textContent = item.value;
    }
    btn.addEventListener('click', () => {
      socket.emit('send_stamp', { type: item.type, value: item.value });
    });
    container.appendChild(btn);
  });
}

socket.on('stamp_broadcast', ({ playerName, type, value }) => {
  const area = document.getElementById('stampToastArea');
  if (!area) return;
  const toast = document.createElement('div');
  toast.className = 'stamp-toast';
  const content = type === 'image'
    ? `<img class="stamp-toast-image" src="${value}" alt="スタンプ">`
    : `<span class="stamp-toast-emoji">${value}</span>`;
  toast.innerHTML = `${content}<span class="stamp-toast-name">${playerName}</span>`;
  area.appendChild(toast);
  setTimeout(() => toast.classList.add('fade-out'), 1800);
  setTimeout(() => toast.remove(), 2300);
});

// ---------- メイン描画 ----------
socket.on('game_state', (state) => {
  latestState = state;
  render(state);
});

function render(state) {
  document.getElementById('roomBadge').classList.remove('hidden');
  document.getElementById('roomCodeLabel').textContent = state.code;

  if (state.phase === 'lobby') {
    renderLobby(state);
    showScreen('lobby');
    return;
  }

  if (state.phase === 'writing') {
    if (state.you === state.round.parentId) {
      renderWritingParent(state);
      showScreen('writingParent');
    } else {
      renderWritingChild(state);
      showScreen('writingChild');
    }
    return;
  }

  if (state.phase === 'reveal') {
    renderReveal(state);
    showScreen('reveal');
    return;
  }

  if (state.phase === 'round_result') {
    renderResult(state);
    showScreen('result');
    return;
  }

  if (state.phase === 'gameover') {
    renderGameOver(state);
    showScreen('gameover');
    return;
  }
}

function nameOf(state, id) {
  const p = state.players.find(p => p.id === id);
  return p ? p.name : '???';
}

function lifeHearts(life) {
  if (life === null || life === undefined) return '';
  let hearts = '';
  for (let i = 0; i < life; i++) hearts += '❤️';
  return hearts || '（0）';
}

function renderLobby(state) {
  const ul = document.getElementById('lobbyPlayers');
  ul.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name;
    if (p.id === state.hostId) li.classList.add('host');
    if (!p.connected) li.classList.add('disconnected');
    ul.appendChild(li);
  });

  const connectedCount = state.players.filter(p => p.connected).length;
  const startingLife = Math.ceil(connectedCount / 2);
  document.getElementById('lobbyLifePreview').textContent =
    connectedCount >= 3 ? `開始時のライフ：${lifeHearts(startingLife)}` : '';

  const isHost = state.you === state.hostId;
  const startBtn = document.getElementById('btnStart');
  const hint = document.getElementById('lobbyHint');
  if (isHost) {
    startBtn.classList.remove('hidden');
    hint.classList.add('hidden');
    startBtn.disabled = connectedCount < 3;
    startBtn.textContent = startBtn.disabled ? '（あと' + (3 - connectedCount) + '人必要です）' : 'ゲーム開始';
  } else {
    startBtn.classList.add('hidden');
    hint.classList.remove('hidden');
  }
}

function roundLabel(state) {
  return `ラウンド ${state.roundIndex + 1} / ${state.totalRounds} — 親：${nameOf(state, state.round.parentId)} — ライフ：${lifeHearts(state.life)}`;
}

function renderWritingChild(state) {
  document.getElementById('writingRoundLabel').textContent = roundLabel(state);
  document.getElementById('answerImg').src = state.round.answerCard ? state.round.answerCard.url : '';

  // ラウンドが変わった時だけ、らくがきをリセットする(再描画のたびには消さない)
  const doodleRoundKey = `${state.roundIndex}-${state.round.answerCard ? state.round.answerCard.id : ''}`;
  if (doodleRoundKey !== lastDoodleRoundKey) {
    lastDoodleRoundKey = doodleRoundKey;
    resizeDoodleCanvas();
    clearDoodle();
  }

  const total = state.round.assignments.length;
  const submittedCount = state.round.assignments.filter(a => a.submitted).length;
  document.getElementById('writingProgress').textContent = `${submittedCount} / ${total} 人 入力済み`;

  const myAssignments = state.round.assignments.filter(a => a.childId === state.you);
  const box = document.getElementById('promptList');

  // 入力中のテキストエリアにフォーカスがあったかどうかを再描画前に記録しておく
  const hadFocus = document.activeElement && document.activeElement.tagName === 'TEXTAREA' && box.contains(document.activeElement);
  const caretPos = hadFocus ? document.activeElement.selectionStart : null;

  box.innerHTML = '';

  myAssignments.forEach(a => {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    if (a.submitted) {
      delete draftTexts[a.index];
      item.innerHTML = `
        <div class="done-label">✔ 送信済み。他のメンバーを待っています…</div>
        <div class="stamp-bar" data-stamp></div>
      `;
      buildStampBar(item.querySelector('[data-stamp]'));
    } else {
      item.innerHTML = `
        <textarea rows="3" maxlength="60" placeholder="見た目から感じたことを自由にどうぞ…"></textarea>
        <button class="btn btn-primary" data-index="${a.index}">この内容で送信</button>
      `;
      const btn = item.querySelector('button');
      const ta = item.querySelector('textarea');
      // 直前まで入力していた内容を復元(再描画でも消えないように)
      ta.value = draftTexts[a.index] || '';
      ta.addEventListener('input', () => {
        draftTexts[a.index] = ta.value;
      });
      btn.addEventListener('click', () => {
        const text = ta.value;
        if (!text.trim()) return;
        socket.emit('submit_profile', { index: a.index, text });
        delete draftTexts[a.index];
        btn.disabled = true;
        btn.textContent = '送信しました';
      });
      if (hadFocus) {
        ta.focus();
        const pos = caretPos !== null ? Math.min(caretPos, ta.value.length) : ta.value.length;
        ta.setSelectionRange(pos, pos);
      }
    }
    box.appendChild(item);
  });

  if (myAssignments.length === 0) {
    box.innerHTML = '<p class="hint">今回あなたに割り当てられたヒントはありません。他のメンバーの記入を待ちましょう。</p>';
  }
}

function renderWritingParent(state) {
  document.getElementById('parentWaitRoundLabel').textContent = roundLabel(state);
  const submitted = state.round.assignments.filter(a => a.submitted).length;
  const total = state.round.assignments.length;
  document.getElementById('submitStatus').textContent = `${submitted} / ${total} 人 入力済み`;

  const stampBar = document.getElementById('stampBarParent');
  if (stampBar && stampBar.childElementCount === 0) {
    buildStampBar(stampBar);
  }
}

function renderReveal(state) {
  document.getElementById('revealRoundLabel').textContent = roundLabel(state);
  const isParent = state.you === state.round.parentId;

  document.getElementById('revealHeading').textContent = isParent
    ? 'あなたはだーれ'
    : 'さあ、親を惑わせよう';

  // 候補写真
  const row = document.getElementById('candidateRow');
  row.innerHTML = '';
  state.round.candidates.forEach(c => {
    const div = document.createElement('div');
    div.className = 'candidate';
    const canPick = isParent;
    if (canPick) div.classList.add('pickable');
    if (!isParent && c.isAnswer) div.classList.add('answer-hint');
    div.innerHTML = `<img src="${c.url}"><div class="tag">${!isParent && c.isAnswer ? '本人はこちら' : '&nbsp;'}</div>`;
    if (canPick) {
      div.addEventListener('click', () => {
        socket.emit('submit_guess', { cardId: c.id });
      });
    }
    row.appendChild(div);
  });

  // ヒントメモ(最初から全公開)
  const notes = document.getElementById('notesArea');
  notes.innerHTML = '';
  state.round.assignments.forEach(a => {
    const div = document.createElement('div');
    div.className = 'note';
    const label = a.childId === state.you ? 'あなたの直感' : `${nameOf(state, a.childId)} さんの直感`;
    div.innerHTML = `<div class="q">${label}</div><div class="a">${a.text}</div>`;
    notes.appendChild(div);
  });

  document.getElementById('parentGuessHint').classList.toggle('hidden', !isParent);
}

function renderResult(state) {
  const g = state.round.guess;
  const heading = g.correct ? '大正解！🎉' : '残念、はずれ…';
  document.getElementById('resultHeading').textContent = heading;

  const reveal = document.getElementById('resultReveal');
  const chosen = state.round.candidates
    ? state.round.candidates.find(c => c.id === g.cardId)
    : null;
  const answer = state.round.answerCard;

  if (g.correct) {
    reveal.innerHTML = answer ? `
      <div class="result-slot">
        <div class="result-label correct">親が選んだ写真＝正解</div>
        <img src="${answer.url}">
      </div>` : '';
  } else {
    reveal.innerHTML = `
      <div class="result-slot">
        <div class="result-label wrong">親が選んだ写真</div>
        ${chosen ? `<img src="${chosen.url}">` : ''}
      </div>
      <div class="result-slot">
        <div class="result-label correct">正解</div>
        ${answer ? `<img src="${answer.url}">` : ''}
      </div>`;
  }

  document.getElementById('lifeStatus').textContent = `残りライフ：${lifeHearts(state.life)}`;

  renderScoreboard(state, 'scoreboard');

  const isHost = state.you === state.hostId;
  const gameWillEnd = state.life !== null && state.life <= 0;
  document.getElementById('btnNext').textContent = gameWillEnd ? '結果を見る' : '次のラウンドへ';
  document.getElementById('btnNext').classList.toggle('hidden', !isHost);
  document.getElementById('nextHint').classList.toggle('hidden', isHost);
}

function renderScoreboard(state, elId) {
  const box = document.getElementById(elId);
  box.innerHTML = '';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${p.name}</span><span>${p.score} 枚</span>`;
    box.appendChild(row);
  });
}

function renderGameOver(state) {
  const isWin = state.outcome === 'win';
  document.getElementById('gameoverHeading').textContent = isWin ? 'ゲームクリア！🎉' : 'ゲームオーバー…';
  document.getElementById('gameoverSub').textContent = isWin
    ? `ライフを${lifeHearts(state.life)}残して全員が親を経験しました！`
    : 'ライフが尽きてしまいました…';

  const finalBoard = document.getElementById('finalScoreboard');
  if (isWin) {
    finalBoard.classList.add('hidden');
  } else {
    finalBoard.classList.remove('hidden');
    renderScoreboard(state, 'finalScoreboard');
  }

  const isHost = state.you === state.hostId;
  document.getElementById('btnPlayAgain').classList.toggle('hidden', !isHost);
  document.getElementById('playAgainHint').classList.toggle('hidden', isHost);
}
