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
const STAMP_ITEMS = Array.from({ length: 32 }, (_, i) => ({
  type: 'image',
  value: `/images/stamps/${String(i + 1).padStart(2, '0')}.png`
}));

// ---------- 落書き機能(人物写真へのみんなで共有らくがき) ----------
const doodleCanvas = document.getElementById('doodleCanvas');
const doodleCtx = doodleCanvas.getContext('2d');
const answerImg = document.getElementById('answerImg');
const colorWheelCanvas = document.getElementById('colorWheelCanvas');
const colorWheelCtx = colorWheelCanvas.getContext('2d');
const colorWheelMarker = document.getElementById('colorWheelMarker');
const colorPreviewFill = document.getElementById('colorPreviewFill');
const doodleSizeSlider = document.getElementById('doodleSize');
const doodleOpacitySlider = document.getElementById('doodleOpacity');
const doodleBrightnessSlider = document.getElementById('doodleBrightness');
const btnEraser = document.getElementById('btnEraser');
const toolTabsBox = document.getElementById('toolTabs');
const paletteGrid = document.getElementById('paletteGrid');
const shapeOptionsBox = document.getElementById('shapeOptions');
const qualityOptionsBox = document.getElementById('qualityOptions');

const PALETTE_COLORS = [
  '#000000', '#414141', '#7d7d7d', '#b5b5b5', '#e5e5e5', '#ffffff',
  '#c1443c', '#e8543c', '#e8a33d', '#e8d23d', '#8bc34a', '#4c7a4a',
  '#2e9b8f', '#3b9fc9', '#3b6ea5', '#5b5ba6', '#7d5ba6', '#a5479e',
  '#d9578f', '#8a5a3c', '#c98a5b', '#6b7280'
];
const SHAPE_OPTIONS = [
  { id: 'round', icon: '⚫', label: '丸' },
  { id: 'square', icon: '⬛', label: '四角' }
];
const QUALITY_OPTIONS = [
  { id: 'solid', icon: '✏️', label: 'なめらか' },
  { id: 'marker', icon: '🖊️', label: '蛍光ペン' },
  { id: 'chalk', icon: '🖍️', label: 'チョーク' }
];

let doodleDrawing = false;
let lastDoodleRoundKey = null;
let doodleLastPoint = null;
let doodleHue = 6;      // 0-360
let doodleSat = 0.66;   // 0-1
let doodleValue = 1;    // 0-1 (明度。ブラシの明度スライダーで変更)
let doodleColor = '#c1443c';
let doodleSize = 4;
let doodleOpacity = 100; // 0-100
let doodleTool = 'pen'; // 'pen' | 'eraser'
let doodleShape = 'round'; // 'round' | 'square'
let doodleQuality = 'solid'; // 'solid' | 'marker' | 'chalk'

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h;
  if (d === 0) h = 0;
  else if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// カラーホイールを描画(角度=色相、中心からの距離=彩度、明度は常に最大で描画)
function buildColorWheel() {
  const size = colorWheelCanvas.width;
  const cx = size / 2, cy = size / 2, radius = size / 2;
  const imageData = colorWheelCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;
      if (dist > radius) { imageData.data[idx + 3] = 0; continue; }
      let angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (angle < 0) angle += 360;
      const sat = Math.min(dist / radius, 1);
      const [r, g, b] = hsvToRgb(angle, sat, 1);
      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = 255;
    }
  }
  colorWheelCtx.putImageData(imageData, 0, 0);
}
buildColorWheel();

function recomputeColor() {
  const [r, g, b] = hsvToRgb(doodleHue, doodleSat, doodleValue);
  doodleColor = rgbToHex(r, g, b);
  updateColorPreview();
}

function updateColorPreview() {
  const [r, g, b] = hexToRgb(doodleColor);
  colorPreviewFill.style.background = `rgba(${r}, ${g}, ${b}, ${doodleOpacity / 100})`;
  updatePaletteActiveState();
}

function setMarkerPosition(x, y) {
  const size = colorWheelCanvas.width;
  colorWheelMarker.style.left = `${(x / size) * 100}%`;
  colorWheelMarker.style.top = `${(y / size) * 100}%`;
}

function pickColorFromWheel(e) {
  const rect = colorWheelCanvas.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  const size = colorWheelCanvas.width;
  const scaleX = size / rect.width;
  const scaleY = size / rect.height;
  let x = (point.clientX - rect.left) * scaleX;
  let y = (point.clientY - rect.top) * scaleY;
  const cx = size / 2, cy = size / 2, radius = size / 2;
  let dx = x - cx, dy = y - cy;
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > radius) {
    dx = (dx / dist) * radius;
    dy = (dy / dist) * radius;
    dist = radius;
    x = cx + dx;
    y = cy + dy;
  }
  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  doodleHue = angle;
  doodleSat = Math.min(dist / radius, 1);
  doodleTool = 'pen';
  setMarkerPosition(x, y);
  recomputeColor();
  updateToolUI();
}

let wheelDragging = false;
colorWheelCanvas.addEventListener('mousedown', (e) => { wheelDragging = true; pickColorFromWheel(e); });
window.addEventListener('mousemove', (e) => { if (wheelDragging) pickColorFromWheel(e); });
window.addEventListener('mouseup', () => { wheelDragging = false; });
colorWheelCanvas.addEventListener('touchstart', (e) => { wheelDragging = true; pickColorFromWheel(e); e.preventDefault(); }, { passive: false });
colorWheelCanvas.addEventListener('touchmove', (e) => { if (wheelDragging) pickColorFromWheel(e); e.preventDefault(); }, { passive: false });
colorWheelCanvas.addEventListener('touchend', () => { wheelDragging = false; });

doodleBrightnessSlider.addEventListener('input', () => {
  doodleValue = +doodleBrightnessSlider.value / 100;
  recomputeColor();
});

// 初期マーカー位置(初期カラーに合わせて配置)
setMarkerPosition(colorWheelCanvas.width * 0.86, colorWheelCanvas.height * 0.5);
recomputeColor();

// ---- パレットタブ ----
PALETTE_COLORS.forEach(hex => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'palette-swatch';
  btn.style.background = hex;
  btn.dataset.hex = hex;
  btn.addEventListener('click', () => {
    const [r, g, b] = hexToRgb(hex);
    const [h, s, v] = rgbToHsv(r, g, b);
    doodleHue = h; doodleSat = s; doodleValue = Math.max(v, 0.04);
    doodleBrightnessSlider.value = Math.round(doodleValue * 100);
    doodleTool = 'pen';
    const cx = colorWheelCanvas.width / 2, cy = colorWheelCanvas.height / 2, radius = colorWheelCanvas.width / 2;
    const rad = (h * Math.PI) / 180;
    setMarkerPosition(cx + Math.cos(rad) * s * radius, cy + Math.sin(rad) * s * radius);
    recomputeColor();
    updateToolUI();
  });
  paletteGrid.appendChild(btn);
});

function updatePaletteActiveState() {
  [...paletteGrid.children].forEach(btn => {
    btn.classList.toggle('active', btn.dataset.hex.toLowerCase() === doodleColor.toLowerCase());
  });
}

// ---- 図形(ペン先)タブ ----
SHAPE_OPTIONS.forEach(opt => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'option-btn' + (opt.id === doodleShape ? ' active' : '');
  btn.innerHTML = `${opt.icon}<span>${opt.label}</span>`;
  btn.addEventListener('click', () => {
    doodleShape = opt.id;
    [...shapeOptionsBox.children].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
  shapeOptionsBox.appendChild(btn);
});

// ---- ペン質タブ ----
QUALITY_OPTIONS.forEach(opt => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'option-btn' + (opt.id === doodleQuality ? ' active' : '');
  btn.innerHTML = `${opt.icon}<span>${opt.label}</span>`;
  btn.addEventListener('click', () => {
    doodleQuality = opt.id;
    [...qualityOptionsBox.children].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
  qualityOptionsBox.appendChild(btn);
});

// ---- タブ切り替え ----
toolTabsBox.querySelectorAll('.tool-tab-btn').forEach(tabBtn => {
  tabBtn.addEventListener('click', () => {
    const target = tabBtn.dataset.tab;
    toolTabsBox.querySelectorAll('.tool-tab-btn').forEach(b => b.classList.toggle('active', b === tabBtn));
    document.querySelectorAll('.tool-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.panel !== target);
    });
  });
});

function updateToolUI() {
  btnEraser.classList.toggle('active', doodleTool === 'eraser');
}

doodleSizeSlider.addEventListener('input', () => {
  doodleSize = +doodleSizeSlider.value;
});
doodleOpacitySlider.addEventListener('input', () => {
  doodleOpacity = +doodleOpacitySlider.value;
  updateColorPreview();
});

btnEraser.addEventListener('click', () => {
  doodleTool = doodleTool === 'eraser' ? 'pen' : 'eraser';
  updateToolUI();
});

function resizeDoodleCanvas() {
  const rect = answerImg.getBoundingClientRect();
  const w = rect.width || 200;
  const h = rect.height || 266;
  // widthやheightへの代入はそれだけでcanvasの内容をクリアしてしまうため、変化時のみ行う
  if (doodleCanvas.width !== w) doodleCanvas.width = w;
  if (doodleCanvas.height !== h) doodleCanvas.height = h;
}

function clearDoodle() {
  doodleCtx.clearRect(0, 0, doodleCanvas.width, doodleCanvas.height);
}

function doodlePos(e) {
  const rect = doodleCanvas.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  return { x: point.clientX - rect.left, y: point.clientY - rect.top };
}

// 実際の線を描く処理。落書きcanvas(自分・共有分)と結果画面の再現の両方から呼ばれる共通関数
function drawStrokeOnContext(ctx, x0, y0, x1, y1, seg) {
  const tool = seg.tool === 'eraser' ? 'eraser' : 'pen';
  const shape = seg.shape === 'square' ? 'square' : 'round';
  const quality = seg.quality || 'solid';
  const alpha = typeof seg.alpha === 'number' ? seg.alpha : 1;
  const size = seg.size || 4;

  if (tool === 'eraser') {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.lineWidth = size * 2.2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return;
  }

  ctx.lineCap = shape === 'square' ? 'square' : 'round';
  ctx.lineJoin = shape === 'square' ? 'miter' : 'round';
  ctx.strokeStyle = seg.color;

  if (quality === 'marker') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.min(1, alpha * 0.8);
    ctx.lineWidth = size * 1.8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  } else if (quality === 'chalk') {
    ctx.globalCompositeOperation = 'source-over';
    const passes = 3;
    for (let i = 0; i < passes; i++) {
      const jitter = size * 0.35;
      const jx = (Math.random() - 0.5) * jitter;
      const jy = (Math.random() - 0.5) * jitter;
      ctx.globalAlpha = alpha * (0.3 + Math.random() * 0.3);
      ctx.lineWidth = size * (0.6 + Math.random() * 0.5);
      ctx.beginPath();
      ctx.moveTo(x0 + jx, y0 + jy);
      ctx.lineTo(x1 + jx, y1 + jy);
      ctx.stroke();
    }
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
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
  const seg = {
    tool: doodleTool, color: doodleColor, size: doodleSize,
    alpha: doodleOpacity / 100, shape: doodleShape, quality: doodleQuality
  };
  drawStrokeOnContext(doodleCtx, prev.x, prev.y, p.x, p.y, seg);
  doodleLastPoint = p;

  // 正規化座標(0〜1)にして他プレイヤーへ送信(画面サイズが違っても対応できるように)
  const w = doodleCanvas.width, h = doodleCanvas.height;
  socket.emit('doodle_draw', {
    x0: prev.x / w, y0: prev.y / h, x1: p.x / w, y1: p.y / h,
    ...seg
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
  drawStrokeOnContext(doodleCtx, seg.x0 * w, seg.y0 * h, seg.x1 * w, seg.y1 * h, seg);
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
const STAMP_PER_PAGE = 9;

function buildStampBar(container) {
  container.innerHTML = '';

  const totalPages = Math.max(1, Math.ceil(STAMP_ITEMS.length / STAMP_PER_PAGE));
  let page = 0;
  let open = false;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'stamp-toggle-btn';
  toggleBtn.textContent = 'スタンプ';

  const panel = document.createElement('div');
  panel.className = 'stamp-panel hidden';

  const grid = document.createElement('div');
  grid.className = 'stamp-grid';

  const nav = document.createElement('div');
  nav.className = 'stamp-nav';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'stamp-nav-btn';
  prevBtn.textContent = '◀';
  const pageLabel = document.createElement('span');
  pageLabel.className = 'stamp-page-label';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'stamp-nav-btn';
  nextBtn.textContent = '▶';

  function renderPage() {
    grid.innerHTML = '';
    const start = page * STAMP_PER_PAGE;
    STAMP_ITEMS.slice(start, start + STAMP_PER_PAGE).forEach(item => {
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
        panel.classList.add('hidden');
        open = false;
      });
      grid.appendChild(btn);
    });
    pageLabel.textContent = `${page + 1} / ${totalPages}`;
    prevBtn.disabled = page === 0;
    nextBtn.disabled = page === totalPages - 1;
  }

  prevBtn.addEventListener('click', () => {
    if (page > 0) { page--; renderPage(); }
  });
  nextBtn.addEventListener('click', () => {
    if (page < totalPages - 1) { page++; renderPage(); }
  });
  toggleBtn.addEventListener('click', () => {
    open = !open;
    panel.classList.toggle('hidden', !open);
  });

  nav.appendChild(prevBtn);
  nav.appendChild(pageLabel);
  nav.appendChild(nextBtn);
  panel.appendChild(grid);
  panel.appendChild(nav);
  container.appendChild(toggleBtn);
  container.appendChild(panel);

  renderPage();
}

// スタンプはいつでも(どの画面でも)送れるよう、1つのグローバルボタンとして初期化
buildStampBar(document.getElementById('floatingStampBar'));

let nextStampSide = 'left';

socket.on('stamp_broadcast', ({ playerName, type, value }) => {
  const side = nextStampSide;
  nextStampSide = nextStampSide === 'left' ? 'right' : 'left';
  const area = document.getElementById(side === 'left' ? 'stampSideLeft' : 'stampSideRight');
  if (!area) return;

  const el = document.createElement(type === 'image' ? 'img' : 'div');
  el.className = 'stamp-side-item';
  if (type === 'image') {
    el.src = value;
    el.alt = 'スタンプ';
  } else {
    el.textContent = value;
    el.classList.add('stamp-side-emoji');
  }
  area.appendChild(el);
  setTimeout(() => el.remove(), 2400);
});

// ---------- メイン描画 ----------
socket.on('game_state', (state) => {
  latestState = state;
  render(state);
});

function render(state) {
  document.getElementById('roomBadge').classList.remove('hidden');
  document.getElementById('roomCodeLabel').textContent = state.code;
  document.getElementById('floatingStampBar').classList.remove('hidden');

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
  const newAnswerUrl = state.round.answerCard ? state.round.answerCard.url : '';
  // 同じURLへの再代入はブラウザによってはload再発火→落書き消去の原因になるため、変化時のみ更新
  if (answerImg.getAttribute('src') !== newAnswerUrl) {
    answerImg.src = newAnswerUrl;
  }

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
      item.innerHTML = `<div class="done-label">✔ 送信済み。他のメンバーを待っています…</div>`;
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
        <div class="result-photo-wrap">
          <img src="${answer.url}">
          <canvas id="resultDoodleCanvas" class="result-doodle-canvas"></canvas>
        </div>
      </div>` : '';
  } else {
    reveal.innerHTML = `
      <div class="result-slot">
        <div class="result-label wrong">親が選んだ写真</div>
        ${chosen ? `<img src="${chosen.url}">` : ''}
      </div>
      <div class="result-slot">
        <div class="result-label correct">正解</div>
        <div class="result-photo-wrap">
          ${answer ? `<img src="${answer.url}">` : ''}
          <canvas id="resultDoodleCanvas" class="result-doodle-canvas"></canvas>
        </div>
      </div>`;
  }

  // みんなが記入中に描いた落書きを、正解写真の上に再現する
  const resultDoodleCanvas = document.getElementById('resultDoodleCanvas');
  if (resultDoodleCanvas && state.round.doodleSegments) {
    const rCtx = resultDoodleCanvas.getContext('2d');
    resultDoodleCanvas.width = 160;
    resultDoodleCanvas.height = 212;
    state.round.doodleSegments.forEach(seg => {
      drawStrokeOnContext(rCtx, seg.x0 * 160, seg.y0 * 212, seg.x1 * 160, seg.y1 * 212, seg);
    });
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
