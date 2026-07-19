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
let mySubmittedThisRender = new Set(); // ローカルの二重送信防止

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

  const isHost = state.you === state.hostId;
  const startBtn = document.getElementById('btnStart');
  const hint = document.getElementById('lobbyHint');
  if (isHost) {
    startBtn.classList.remove('hidden');
    hint.classList.add('hidden');
    startBtn.disabled = state.players.filter(p => p.connected).length < 3;
    startBtn.textContent = startBtn.disabled ? '（あと' + (3 - state.players.filter(p => p.connected).length) + '人必要です）' : 'ゲーム開始';
  } else {
    startBtn.classList.add('hidden');
    hint.classList.remove('hidden');
  }
}

function roundLabel(state) {
  return `ラウンド ${state.roundIndex + 1} / ${state.totalRounds} — 親：${nameOf(state, state.round.parentId)}`;
}

function renderWritingChild(state) {
  document.getElementById('writingRoundLabel').textContent = roundLabel(state);
  document.getElementById('answerImg').src = state.round.answerCard ? state.round.answerCard.url : '';

  const myAssignments = state.round.assignments.filter(a => a.childId === state.you);
  const box = document.getElementById('promptList');
  box.innerHTML = '';

  myAssignments.forEach(a => {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    if (a.submitted) {
      item.innerHTML = `<div class="q">${a.prompt}</div><div class="done-label">✔ 送信済み。他のメンバーを待っています…</div>`;
    } else {
      item.innerHTML = `
        <div class="q">${a.prompt}</div>
        <textarea rows="2" maxlength="60" placeholder="見た目から想像して自由にどうぞ…"></textarea>
        <button class="btn btn-primary" data-index="${a.index}">この内容で送信</button>
      `;
      const btn = item.querySelector('button');
      const ta = item.querySelector('textarea');
      btn.addEventListener('click', () => {
        const text = ta.value;
        if (!text.trim()) return;
        socket.emit('submit_profile', { index: a.index, text });
        btn.disabled = true;
        btn.textContent = '送信しました';
      });
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
  document.getElementById('submitStatus').textContent = `${submitted} / ${total} 件、記入完了`;
}

function renderReveal(state) {
  document.getElementById('revealRoundLabel').textContent = roundLabel(state);
  const isParent = state.you === state.round.parentId;
  const allRevealed = state.round.assignments.every(a => a.revealed);

  document.getElementById('revealHeading').textContent = isParent
    ? 'あなたはだーれ'
    : 'ヒントを開いて正解を導こう';

  // 候補写真
  const row = document.getElementById('candidateRow');
  row.innerHTML = '';
  state.round.candidates.forEach(c => {
    const div = document.createElement('div');
    div.className = 'candidate';
    const canPick = isParent && allRevealed;
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

  // ヒントメモ
  const notes = document.getElementById('notesArea');
  notes.innerHTML = '';
  state.round.assignments.forEach(a => {
    const div = document.createElement('div');
    div.className = 'note';
    if (a.revealed) {
      div.innerHTML = `<div class="q">${a.prompt}</div><div class="a">${a.text}</div>`;
    } else if (a.childId === state.you) {
      div.innerHTML = `<div class="q">${a.prompt}</div><div class="locked">あなたの回答：まだ非公開</div>
        <button class="btn btn-outline">このヒントを公開する</button>`;
      div.querySelector('button').addEventListener('click', () => {
        socket.emit('reveal_profile', { index: a.index });
      });
    } else {
      div.innerHTML = `<div class="q">${a.prompt}</div><div class="locked">${nameOf(state, a.childId)} さんが考え中…（非公開）</div>`;
    }
    notes.appendChild(div);
  });

  document.getElementById('parentGuessHint').classList.toggle('hidden', !(isParent && allRevealed));
}

function renderResult(state) {
  const g = state.round.guess;
  const heading = g.correct ? '大正解！🎉' : '残念、はずれ…';
  document.getElementById('resultHeading').textContent = heading;

  const reveal = document.getElementById('resultReveal');
  reveal.innerHTML = state.round.answerCard ? `<img src="${state.round.answerCard.url}">` : '';

  renderScoreboard(state, 'scoreboard');

  const isHost = state.you === state.hostId;
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
  renderScoreboard(state, 'finalScoreboard');
}
