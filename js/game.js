// game.js — İzometrik şehir builder oyun motoru

import {
  placeTile, finishBuilding, demolishOwn, requestDemolish, respondDemolish,
  transferToFund, transferFromFund, transferBetweenPlayers,
  addToExpansionFund, requestExpansion, voteExpansion,
  listenToGameState, EXPAND_COST, STARTING_BUDGET
} from "./firebase-manager.js";

// ── TILE TANIMLARI ────────────────────────────────────────────────────────────
export const TILES = {
  road:        { label: "Yol",          cost: 200,   icon: "🛣️",  color: "#555", w:1, h:1 },
  house:       { label: "Konut",        cost: 1500,  icon: "🏠",  color: "#4a9eff", w:1, h:1 },
  apartment:   { label: "Apartman",     cost: 4000,  icon: "🏢",  color: "#3a7fdd", w:1, h:1 },
  shop:        { label: "Dükkan",       cost: 2000,  icon: "🏪",  color: "#f4a300", w:1, h:1 },
  office:      { label: "Ofis",         cost: 5000,  icon: "🏬",  color: "#e0a000", w:1, h:1 },
  factory:     { label: "Fabrika",      cost: 6000,  icon: "🏭",  color: "#888", w:1, h:1 },
  park:        { label: "Park",         cost: 800,   icon: "🌳",  color: "#2d8a4e", w:1, h:1 },
  hospital:    { label: "Hastane",      cost: 8000,  icon: "🏥",  color: "#e55", w:1, h:1 },
  school:      { label: "Okul",         cost: 5000,  icon: "🏫",  color: "#a66", w:1, h:1 },
  firestation: { label: "İtfaiye",      cost: 4500,  icon: "🚒",  color: "#c33", w:1, h:1 },
  police:      { label: "Karakol",      cost: 4500,  icon: "🚓",  color: "#33c", w:1, h:1 },
  stadium:     { label: "Stadyum",      cost: 15000, icon: "🏟️",  color: "#c8a000", w:2, h:2 },
  fund:        { label: "Fon Binası",   cost: 0,     icon: "🏦",  color: "#ffd700", w:1, h:1, unique:true },
};

const TILE_CATEGORIES = {
  "Altyapı":  ["road"],
  "Konut":    ["house", "apartment"],
  "Ticaret":  ["shop", "office"],
  "Sanayi":   ["factory"],
  "Yeşil":    ["park"],
  "Kamu":     ["hospital", "school", "firestation", "police", "stadium"],
};

// İzometrik sabitler
const TILE_W  = 64;   // piksel genişlik (yatay projeksiyon)
const TILE_H  = 32;   // piksel yükseklik (dikey projeksiyon)
const TILE_TH = 20;   // tile "duvar" yüksekliği

// ── STATE ─────────────────────────────────────────────────────────────────────
let roomId, myUser, roomData, gameState;
let unsubGS;
let canvas, ctx;
let camX = 0, camY = 0;
let dragging = false, dragStart = { x:0, y:0 }, camStart = { x:0, y:0 };
let selectedTool = null;   // "build" | "demolish" | "fund" | null
let selectedTile = null;   // tile type key
let hoverCell    = null;   // {x, y}
let buildQueue   = {};     // key → { timer, progress }

// ── INIT ──────────────────────────────────────────────────────────────────────
export function initGame(rId, rData, user) {
  roomId   = rId;
  roomData = rData;
  myUser   = user;

  canvas = document.getElementById("game-canvas");
  ctx    = canvas.getContext("2d");

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  centerCamera();
  buildUI();
  bindEvents();

  // Firebase dinle
  unsubGS = listenToGameState(roomId, gs => {
    const prev = gameState;
    gameState  = gs;
    handleGameStateChange(prev, gs);
    render();
  });

  requestAnimationFrame(loop);
}

function resizeCanvas() {
  const cont = document.getElementById("game-canvas-container");
  canvas.width  = cont.clientWidth;
  canvas.height = cont.clientHeight;
}

function centerCamera() {
  if (!gameState) { camX = canvas.width/2; camY = 80; return; }
  const gs = gameState.gridSize || 20;
  camX = canvas.width  / 2;
  camY = canvas.height / 2 - (gs * TILE_H / 2);
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!gameState) {
    ctx.fillStyle = "#8b949e";
    ctx.font = "16px IBM Plex Sans";
    ctx.textAlign = "center";
    ctx.fillText("Yükleniyor...", canvas.width/2, canvas.height/2);
    return;
  }

  const gs = gameState.gridSize || 20;
  drawGrid(gs);
  drawTiles(gs);
  drawHover(gs);
  drawEdgeButtons(gs);
}

function isoToScreen(gx, gy) {
  return {
    sx: camX + (gx - gy) * (TILE_W / 2),
    sy: camY + (gx + gy) * (TILE_H / 2)
  };
}

function screenToIso(sx, sy) {
  const rx = sx - camX;
  const ry = sy - camY;
  return {
    gx: Math.floor((rx / (TILE_W/2) + ry / (TILE_H/2)) / 2),
    gy: Math.floor((ry / (TILE_H/2) - rx / (TILE_W/2)) / 2)
  };
}

function drawGrid(gs) {
  ctx.save();
  for (let x = 0; x < gs; x++) {
    for (let y = 0; y < gs; y++) {
      const { sx, sy } = isoToScreen(x, y);
      drawDiamond(sx, sy, "#1a1f27", "#2d333b", 0.85);
    }
  }
  ctx.restore();
}

function drawDiamond(sx, sy, fill, stroke, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(sx,           sy - TILE_H/2);
  ctx.lineTo(sx + TILE_W/2, sy);
  ctx.lineTo(sx,           sy + TILE_H/2);
  ctx.lineTo(sx - TILE_W/2, sy);
  ctx.closePath();
  if (fill)   { ctx.fillStyle = fill;     ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.5; ctx.stroke(); }
  ctx.globalAlpha = 1;
}

function drawTiles(gs) {
  if (!gameState.tiles) return;

  // Derinlik sıralaması için sort
  const entries = Object.entries(gameState.tiles).sort(([k1], [k2]) => {
    const [x1,y1] = k1.split(",").map(Number);
    const [x2,y2] = k2.split(",").map(Number);
    return (x1+y1) - (x2+y2);
  });

  for (const [key, tile] of entries) {
    const [gx, gy] = key.split(",").map(Number);
    drawTile(gx, gy, tile, key);
  }
}

function drawTile(gx, gy, tile, key) {
  const def = TILES[tile.type];
  if (!def) return;

  const { sx, sy } = isoToScreen(gx, gy);
  const progress = buildQueue[key]?.progress ?? 1;
  const tH = TILE_TH * progress;

  // Sahip rengi
  const ownerColor = getPlayerColor(tile.ownerId);

  // İnşaat ise yarı saydamlık
  ctx.globalAlpha = tile.building ? 0.6 + 0.4 * progress : 1;

  // Sol yüz (gölge)
  ctx.beginPath();
  ctx.moveTo(sx - TILE_W/2, sy);
  ctx.lineTo(sx - TILE_W/2, sy - tH);
  ctx.lineTo(sx,            sy + TILE_H/2 - tH);
  ctx.lineTo(sx,            sy + TILE_H/2);
  ctx.closePath();
  ctx.fillStyle = shadeColor(def.color, -40);
  ctx.fill();

  // Sağ yüz
  ctx.beginPath();
  ctx.moveTo(sx + TILE_W/2, sy);
  ctx.lineTo(sx + TILE_W/2, sy - tH);
  ctx.lineTo(sx,            sy + TILE_H/2 - tH);
  ctx.lineTo(sx,            sy + TILE_H/2);
  ctx.closePath();
  ctx.fillStyle = shadeColor(def.color, -20);
  ctx.fill();

  // Üst yüz
  ctx.beginPath();
  ctx.moveTo(sx,            sy - TILE_H/2 - tH);
  ctx.lineTo(sx + TILE_W/2, sy - tH);
  ctx.lineTo(sx,            sy + TILE_H/2 - tH);
  ctx.lineTo(sx - TILE_W/2, sy - tH);
  ctx.closePath();
  ctx.fillStyle = def.color;
  ctx.fill();

  // Sahip kenar çizgisi (üst yüz)
  ctx.strokeStyle = ownerColor;
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Emoji icon
  ctx.globalAlpha = tile.building ? 0.5 + 0.5*progress : 1;
  ctx.font = "18px serif";
  ctx.textAlign = "center";
  ctx.fillText(def.icon, sx, sy - tH - TILE_H/4);

  // İnşaat % göstergesi
  if (tile.building && progress < 1) {
    ctx.font = "bold 10px IBM Plex Mono";
    ctx.fillStyle = "#fff";
    ctx.fillText(`${Math.round(progress*100)}%`, sx, sy - tH + 4);
  }

  ctx.globalAlpha = 1;
}

function drawHover(gs) {
  if (!hoverCell) return;
  const { x, y } = hoverCell;
  if (x < 0 || y < 0 || x >= gs || y >= gs) return;

  const { sx, sy } = isoToScreen(x, y);
  const isValid = canPlaceHere(x, y);
  const col = selectedTool === "demolish" ? "#ff4444"
            : isValid ? "#58a6ff"
            : "#ff4444";

  drawDiamond(sx, sy, col + "30", col, 1);
}

function drawEdgeButtons(gs) {
  const dirs = [
    { dir: "north", gx: gs/2, gy: -1.5 },
    { dir: "south", gx: gs/2, gy: gs + 0.5 },
    { dir: "west",  gx: -1.5, gy: gs/2 },
    { dir: "east",  gx: gs + 0.5, gy: gs/2 },
  ];

  ctx.save();
  ctx.font = "bold 13px IBM Plex Mono";
  ctx.textAlign = "center";

  for (const { dir, gx, gy } of dirs) {
    const { sx, sy } = isoToScreen(gx, gy);
    const canExpand  = (gameState?.fund?.expansionFund ?? 0) >= EXPAND_COST;

    ctx.beginPath();
    ctx.arc(sx, sy, 18, 0, Math.PI*2);
    ctx.fillStyle   = canExpand ? "#1f6feb" : "#21262d";
    ctx.strokeStyle = canExpand ? "#58a6ff" : "#30363d";
    ctx.lineWidth   = 1.5;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = canExpand ? "#fff" : "#484f58";
    ctx.fillText("+", sx, sy + 5);
  }
  ctx.restore();
}

// ── EVENTS ────────────────────────────────────────────────────────────────────
function bindEvents() {
  canvas.addEventListener("mousedown",  onMouseDown);
  canvas.addEventListener("mousemove",  onMouseMove);
  canvas.addEventListener("mouseup",    onMouseUp);
  canvas.addEventListener("mouseleave", onMouseUp);
  canvas.addEventListener("click",      onClick);
  canvas.addEventListener("wheel",      onWheel, { passive: true });

  // Touch
  canvas.addEventListener("touchstart",  onTouchStart, { passive: true });
  canvas.addEventListener("touchmove",   onTouchMove,  { passive: false });
  canvas.addEventListener("touchend",    onTouchEnd);
}

function onMouseDown(e) {
  if (e.button === 1 || (e.button === 0 && !selectedTool)) {
    dragging  = true;
    dragStart = { x: e.clientX, y: e.clientY };
    camStart  = { x: camX, y: camY };
    canvas.style.cursor = "grabbing";
  }
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (dragging) {
    camX = camStart.x + (e.clientX - dragStart.x);
    camY = camStart.y + (e.clientY - dragStart.y);
  }

  const { gx, gy } = screenToIso(mx, my);
  hoverCell = { x: gx, y: gy };
}

function onMouseUp(e) {
  if (dragging) { dragging = false; canvas.style.cursor = "default"; }
}

let _lastClickTime = 0;
async function onClick(e) {
  const now = Date.now();
  if (now - _lastClickTime < 200) return; // debounce
  _lastClickTime = now;
  if (dragging) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Edge butonları kontrol et
  if (checkEdgeButtonClick(mx, my)) return;

  const { gx, gy } = screenToIso(mx, my);
  const gs = gameState?.gridSize || 20;
  if (gx < 0 || gy < 0 || gx >= gs || gy >= gs) return;

  if (selectedTool === "build" && selectedTile) {
    await handleBuildClick(gx, gy);
  } else if (selectedTool === "demolish") {
    await handleDemolishClick(gx, gy);
  } else if (selectedTool === "fund") {
    await handleFundClick(gx, gy);
  } else {
    handleInfoClick(gx, gy);
  }
}

function checkEdgeButtonClick(mx, my) {
  if (!gameState) return false;
  const gs = gameState.gridSize || 20;
  const dirs = [
    { dir: "north", gx: gs/2, gy: -1.5 },
    { dir: "south", gx: gs/2, gy: gs + 0.5 },
    { dir: "west",  gx: -1.5, gy: gs/2 },
    { dir: "east",  gx: gs + 0.5, gy: gs/2 },
  ];
  for (const { dir, gx, gy } of dirs) {
    const { sx, sy } = isoToScreen(gx, gy);
    const dist = Math.hypot(mx - sx, my - sy);
    if (dist < 18) {
      openExpansionModal(dir);
      return true;
    }
  }
  return false;
}

function onWheel(e) {
  // Zoom — basit scale ile değil cam offset ile yaklaştırma
  // İleride eklenebilir; şimdilik pan yeterli
}

let _touches = [];
function onTouchStart(e) {
  _touches = [...e.touches];
  if (e.touches.length === 1) {
    dragging  = true;
    dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    camStart  = { x: camX, y: camY };
  }
}
function onTouchMove(e) {
  if (e.touches.length === 1 && dragging) {
    e.preventDefault();
    camX = camStart.x + (e.touches[0].clientX - dragStart.x);
    camY = camStart.y + (e.touches[0].clientY - dragStart.y);
  }
}
function onTouchEnd(e) { dragging = false; }

// ── OYUN AKSİYONLARI ──────────────────────────────────────────────────────────
async function handleBuildClick(gx, gy) {
  if (!selectedTile) return;
  const def = TILES[selectedTile];
  if (!def) return;

  // Fon binası özel — sadece bir tane olabilir
  if (def.unique) {
    const already = Object.values(gameState.tiles || {}).find(t => t.type === selectedTile);
    if (already) { showToast("Bu binanın sadece bir tanesi olabilir", "error"); return; }
  }

  try {
    const key = await placeTile(roomId, gx, gy, selectedTile, def.cost);
    startBuildAnimation(key);
    showToast(`${def.label} inşaatı başladı!`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleDemolishClick(gx, gy) {
  const key  = `${gx},${gy}`;
  const tile = gameState?.tiles?.[key];
  if (!tile) { showToast("Boş alan", "info"); return; }

  if (tile.ownerId === myUser.uid) {
    if (!confirm(`"${TILES[tile.type]?.label || tile.type}" yıkılsın mı?`)) return;
    try {
      await demolishOwn(roomId, gx, gy);
      showToast("Yıkıldı", "success");
    } catch (err) { showToast(err.message, "error"); }
  } else {
    if (!confirm(`${tile.ownerName}'in "${TILES[tile.type]?.label || tile.type}" binası için yıkım izni iste?`)) return;
    try {
      await requestDemolish(roomId, gx, gy);
      showToast(`${tile.ownerName}'e yıkım isteği gönderildi`, "info");
    } catch (err) { showToast(err.message, "error"); }
  }
}

async function handleFundClick(gx, gy) {
  // Fon binasına tıklandıysa fon menüsü aç
  const key  = `${gx},${gy}`;
  const tile = gameState?.tiles?.[key];
  if (tile?.type === "fund") {
    openFundModal();
  } else {
    showToast("Fon binasına tıkla", "info");
  }
}

function handleInfoClick(gx, gy) {
  const key  = `${gx},${gy}`;
  const tile = gameState?.tiles?.[key];
  if (!tile) return;
  const def = TILES[tile.type];
  showToast(`${def?.icon || ""} ${def?.label || tile.type} — ${tile.ownerName}`, "info");
}

// ── İNŞAAT ANİMASYONU ─────────────────────────────────────────────────────────
function startBuildAnimation(key) {
  buildQueue[key] = { progress: 0, startTime: Date.now(), duration: 2000 };
}

function handleGameStateChange(prev, next) {
  if (!next?.tiles) return;

  // Yeni veya building=true olan tile'lar için animasyon kuyruğuna ekle
  Object.entries(next.tiles).forEach(([key, tile]) => {
    if (tile.building && !buildQueue[key]) {
      buildQueue[key] = { progress: 0, startTime: Date.now(), duration: 2000 };
    }
  });

  // Demolish istekleri — bana gelen var mı?
  checkDemolishRequests(next);

  // Expansion oyu var mı?
  checkExpansionVote(next);

  // Bütçe / metrikleri güncelle
  updateHUD(next);
}

function updateBuildQueues() {
  const now = Date.now();
  for (const [key, q] of Object.entries(buildQueue)) {
    q.progress = Math.min(1, (now - q.startTime) / q.duration);
    if (q.progress >= 1) {
      delete buildQueue[key];
      finishBuilding(roomId, key).catch(() => {});
    }
  }
}

function loop() {
  updateBuildQueues();
  render();
  requestAnimationFrame(loop);
}

// ── DEMOLISH REQUESTS ─────────────────────────────────────────────────────────
let _shownDemolishReqs = new Set();

function checkDemolishRequests(gs) {
  if (!gs.demolishRequests) return;
  Object.entries(gs.demolishRequests).forEach(([reqId, req]) => {
    if (req.targetUid === myUser.uid && req.status === "pending" && !_shownDemolishReqs.has(reqId)) {
      _shownDemolishReqs.add(reqId);
      showDemolishRequest(reqId, req);
    }
  });
}

function showDemolishRequest(reqId, req) {
  const overlay = document.getElementById("game-ui-overlay");
  const card = document.createElement("div");
  card.id = `demolish-req-${reqId}`;
  card.style.cssText = `
    pointer-events: auto;
    position: absolute;
    top: 1rem; right: 1rem;
    background: #161b22; border: 1px solid #f85149;
    border-radius: 8px; padding: 1rem 1.25rem;
    max-width: 280px; font-size: 13px; z-index: 10;
    animation: slideIn 0.3s ease;
  `;
  const tileName = TILES[req.tileType]?.label || req.tileType;
  card.innerHTML = `
    <div style="font-weight:600; color:#f85149; margin-bottom:6px">⚠ Yıkım İsteği</div>
    <div style="color:#e6edf3; margin-bottom:10px">
      <b>${req.requesterName}</b>, senin <b>${tileName}</b> binasını yıkmak istiyor.
    </div>
    <div style="display:flex; gap:8px;">
      <button id="demolish-accept-${reqId}" style="flex:1; background:#490202; color:#f85149; border:1px solid #f85149; border-radius:6px; padding:6px; cursor:pointer; font-size:12px;">
        ✓ İzin Ver
      </button>
      <button id="demolish-reject-${reqId}" style="flex:1; background:#21262d; color:#8b949e; border:1px solid #30363d; border-radius:6px; padding:6px; cursor:pointer; font-size:12px;">
        ✗ Reddet
      </button>
    </div>
  `;
  overlay.appendChild(card);

  document.getElementById(`demolish-accept-${reqId}`).onclick = async () => {
    await respondDemolish(roomId, reqId, true);
    card.remove();
    showToast("Yıkım izni verildi", "success");
  };
  document.getElementById(`demolish-reject-${reqId}`).onclick = async () => {
    await respondDemolish(roomId, reqId, false);
    card.remove();
    showToast("Yıkım reddedildi", "info");
  };

  // Reddedilen/silinen istekleri temizle
  setTimeout(() => { if (document.getElementById(`demolish-req-${reqId}`)) card.remove(); }, 30000);
}

// ── EXPANSION VOTE ────────────────────────────────────────────────────────────
let _shownExpansionVote = false;

function checkExpansionVote(gs) {
  if (!gs.pendingExpansion) { _shownExpansionVote = false; return; }
  const pending = gs.pendingExpansion;
  const myVote  = pending.votes?.[myUser.uid];
  if (myVote !== undefined || _shownExpansionVote) return;
  _shownExpansionVote = true;
  showExpansionVoteCard(pending);
}

function showExpansionVoteCard(pending) {
  const overlay = document.getElementById("game-ui-overlay");
  const dirLabels = { north:"Kuzey", south:"Güney", west:"Batı", east:"Doğu" };
  const card = document.createElement("div");
  card.id = "expansion-vote-card";
  card.style.cssText = `
    pointer-events: auto; position: absolute; top: 1rem; left: 50%; transform: translateX(-50%);
    background: #161b22; border: 1px solid #1f6feb; border-radius: 8px;
    padding: 1rem 1.25rem; max-width: 300px; font-size: 13px; z-index: 10; text-align: center;
  `;
  card.innerHTML = `
    <div style="font-weight:600; color:#58a6ff; margin-bottom:6px">🏙 Şehir Genişletme</div>
    <div style="color:#e6edf3; margin-bottom:10px">
      <b>${pending.requestedByName}</b>, şehri <b>${dirLabels[pending.direction] || pending.direction}</b> yönüne genişletmek istiyor.<br>
      <span style="color:#8b949e; font-size:12px;">Maliyet: ${pending.cost.toLocaleString()}₺</span>
    </div>
    <div style="display:flex; gap:8px;">
      <button id="exp-yes" style="flex:1; background:#0d419d; color:#58a6ff; border:1px solid #1f6feb; border-radius:6px; padding:6px; cursor:pointer;">✓ Onayla</button>
      <button id="exp-no"  style="flex:1; background:#21262d; color:#8b949e; border:1px solid #30363d; border-radius:6px; padding:6px; cursor:pointer;">✗ Reddet</button>
    </div>
  `;
  overlay.appendChild(card);

  document.getElementById("exp-yes").onclick = async () => {
    await voteExpansion(roomId, true);
    card.remove();
    showToast("Genişletmeye oy verdin!", "success");
  };
  document.getElementById("exp-no").onclick = async () => {
    await voteExpansion(roomId, false);
    card.remove();
    showToast("Genişletmeyi reddettin", "info");
  };
}

// ── MODALLER ──────────────────────────────────────────────────────────────────
function openFundModal() {
  const players   = roomData?.players || {};
  const budgets   = gameState?.budgets || {};
  const fund      = gameState?.fund || {};
  const myBudget  = budgets[myUser.uid] || 0;

  const playerOptions = Object.entries(players)
    .filter(([uid]) => uid !== myUser.uid)
    .map(([uid, p]) => `<option value="${uid}">${p.name} (${(budgets[uid]||0).toLocaleString()}₺)</option>`)
    .join("");

  showModal("🏦 Fon Binası", `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
      <div style="background:#21262d; border-radius:6px; padding:10px; text-align:center;">
        <div style="font-size:11px; color:#8b949e; margin-bottom:4px;">Genel Fon</div>
        <div style="font-size:20px; font-weight:600; color:#58a6ff;">${(fund.balance||0).toLocaleString()}₺</div>
      </div>
      <div style="background:#21262d; border-radius:6px; padding:10px; text-align:center;">
        <div style="font-size:11px; color:#8b949e; margin-bottom:4px;">Expansion Fonu</div>
        <div style="font-size:20px; font-weight:600; color:#3fb950;">${(fund.expansionFund||0).toLocaleString()}₺</div>
      </div>
    </div>
    <div style="font-size:11px; color:#8b949e; margin-bottom:8px;">Benim bütçem: <b style="color:#e6edf3;">${myBudget.toLocaleString()}₺</b></div>

    <div style="border-top:1px solid #30363d; padding-top:12px; margin-top:4px;">
      <div style="font-weight:600; margin-bottom:8px; font-size:13px;">💸 Genel Fona Para Yatır</div>
      <div style="display:flex; gap:8px; margin-bottom:4px;">
        <input id="fund-deposit-amt" type="number" min="100" max="${myBudget}" value="1000"
          style="flex:1; background:#21262d; border:1px solid #30363d; border-radius:6px; color:#e6edf3; padding:6px 10px; font-size:13px;" />
        <button id="fund-deposit-btn" class="btn btn-primary" style="white-space:nowrap;">Yatır</button>
      </div>
    </div>

    <div style="border-top:1px solid #30363d; padding-top:12px; margin-top:8px;">
      <div style="font-weight:600; margin-bottom:8px; font-size:13px;">🤝 Oyuncuya Transfer</div>
      <select id="fund-target-player" style="width:100%; background:#21262d; border:1px solid #30363d; border-radius:6px; color:#e6edf3; padding:6px 10px; font-size:13px; margin-bottom:6px;">
        ${playerOptions || '<option disabled>Başka oyuncu yok</option>'}
      </select>
      <div style="display:flex; gap:8px;">
        <input id="fund-transfer-amt" type="number" min="100" max="${myBudget}" value="1000"
          style="flex:1; background:#21262d; border:1px solid #30363d; border-radius:6px; color:#e6edf3; padding:6px 10px; font-size:13px;" />
        <button id="fund-transfer-btn" class="btn btn-primary" style="white-space:nowrap;">Gönder</button>
      </div>
    </div>

    <div style="border-top:1px solid #30363d; padding-top:12px; margin-top:8px;">
      <div style="font-weight:600; margin-bottom:8px; font-size:13px;">🌆 Expansion Fonuna Ekle</div>
      <div style="font-size:11px; color:#8b949e; margin-bottom:6px;">Hedef: ${EXPAND_COST.toLocaleString()}₺</div>
      <div style="display:flex; gap:8px;">
        <input id="fund-expand-amt" type="number" min="100" max="${myBudget}" value="5000"
          style="flex:1; background:#21262d; border:1px solid #30363d; border-radius:6px; color:#e6edf3; padding:6px 10px; font-size:13px;" />
        <button id="fund-expand-btn" class="btn btn-success" style="white-space:nowrap;">Ekle</button>
      </div>
    </div>
  `, async () => {});

  document.getElementById("fund-deposit-btn").onclick = async () => {
    const amt = parseInt(document.getElementById("fund-deposit-amt").value);
    try { await transferToFund(roomId, amt); showToast(`${amt.toLocaleString()}₺ fona yatırıldı`, "success"); closeModal(); }
    catch(e) { showToast(e.message, "error"); }
  };

  document.getElementById("fund-transfer-btn").onclick = async () => {
    const toUid = document.getElementById("fund-target-player").value;
    const amt   = parseInt(document.getElementById("fund-transfer-amt").value);
    if (!toUid) return;
    try { await transferBetweenPlayers(roomId, toUid, amt); showToast(`${amt.toLocaleString()}₺ transfer edildi`, "success"); closeModal(); }
    catch(e) { showToast(e.message, "error"); }
  };

  document.getElementById("fund-expand-btn").onclick = async () => {
    const amt = parseInt(document.getElementById("fund-expand-amt").value);
    try { await addToExpansionFund(roomId, amt); showToast(`${amt.toLocaleString()}₺ expansion fonuna eklendi`, "success"); closeModal(); }
    catch(e) { showToast(e.message, "error"); }
  };
}

function openExpansionModal(direction) {
  const fund = gameState?.fund || {};
  const expFund = fund.expansionFund || 0;
  const canExpand = expFund >= EXPAND_COST;
  const dirLabels = { north:"Kuzey", south:"Güney", west:"Batı", east:"Doğu" };

  showModal("🌆 Şehir Genişlet", `
    <div style="text-align:center; margin-bottom:16px;">
      <div style="font-size:2rem; margin-bottom:8px;">
        ${direction==="north"?"⬆️":direction==="south"?"⬇️":direction==="west"?"⬅️":"➡️"}
      </div>
      <div style="font-size:15px; font-weight:600; margin-bottom:4px;">${dirLabels[direction]} yönüne genişlet</div>
      <div style="color:#8b949e; font-size:13px;">Grid: +4 satır/sütun</div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px;">
      <div style="background:#21262d; border-radius:6px; padding:10px; text-align:center;">
        <div style="font-size:11px; color:#8b949e;">Mevcut Fon</div>
        <div style="font-size:18px; font-weight:600; color:${canExpand?"#3fb950":"#f85149"};">${expFund.toLocaleString()}₺</div>
      </div>
      <div style="background:#21262d; border-radius:6px; padding:10px; text-align:center;">
        <div style="font-size:11px; color:#8b949e;">Gereken</div>
        <div style="font-size:18px; font-weight:600; color:#58a6ff;">${EXPAND_COST.toLocaleString()}₺</div>
      </div>
    </div>
    ${!canExpand ? `<div style="background:#490202; border:1px solid #f85149; border-radius:6px; padding:10px; color:#f85149; font-size:12px; margin-bottom:12px; text-align:center;">
      Fon yetersiz. ${(EXPAND_COST-expFund).toLocaleString()}₺ daha gerekli.<br>Fon binasından expansion fonuna para ekle.
    </div>` : `<div style="background:#0d2a0d; border:1px solid #3fb950; border-radius:6px; padding:10px; color:#3fb950; font-size:12px; margin-bottom:12px; text-align:center;">
      Fon yeterli! Tüm oyuncuların oyu alınacak.
    </div>`}
    <button id="expand-confirm" class="btn btn-primary btn-full" ${canExpand?"":"disabled"}>
      Genişletme İsteği Gönder
    </button>
  `, () => {});

  if (canExpand) {
    document.getElementById("expand-confirm").onclick = async () => {
      try {
        await requestExpansion(roomId, direction);
        showToast("Genişletme oyu başlatıldı!", "success");
        closeModal();
      } catch(e) { showToast(e.message, "error"); }
    };
  }
}

// ── HUD GÜNCELLEMESİ ─────────────────────────────────────────────────────────
function updateHUD(gs) {
  const myBudget = gs.budgets?.[myUser.uid] ?? 0;
  const el = document.getElementById("hud-budget");
  if (el) el.textContent = myBudget.toLocaleString() + "₺";

  const tileCount = Object.keys(gs.tiles || {}).length;
  const pop = document.getElementById("hud-pop");
  if (pop) pop.textContent = (tileCount * 15).toLocaleString();

  const fund = document.getElementById("hud-fund");
  if (fund) fund.textContent = (gs.fund?.balance ?? 0).toLocaleString() + "₺";

  const expFund = document.getElementById("hud-expfund");
  if (expFund) expFund.textContent = (gs.fund?.expansionFund ?? 0).toLocaleString() + "₺";
}

// ── UI OLUŞTURMA ──────────────────────────────────────────────────────────────
function buildUI() {
  buildToolbar();
  buildHUD();
}

function buildHUD() {
  const statEl = document.getElementById("game-stats");
  if (!statEl) return;
  statEl.innerHTML = `
    <span title="Bütçen">💰 <span id="hud-budget">50,000₺</span></span>
    <span title="Nüfus">👥 <span id="hud-pop">0</span></span>
    <span title="Genel Fon">🏦 <span id="hud-fund">0₺</span></span>
    <span title="Expansion Fonu">🌆 <span id="hud-expfund">0₺</span></span>
  `;
}

function buildToolbar() {
  const toolbar = document.getElementById("game-toolbar");
  if (!toolbar) return;
  toolbar.innerHTML = "";

  // Mod butonları
  const modes = [
    { id: "mode-build",   label: "🔨 İnşa",   tool: "build"    },
    { id: "mode-demolish",label: "💥 Yık",    tool: "demolish" },
    { id: "mode-fund",    label: "🏦 Fon",    tool: "fund"     },
    { id: "mode-pan",     label: "✋ Pan",    tool: null       },
  ];

  const modeBar = document.createElement("div");
  modeBar.style.cssText = "display:flex; gap:6px; align-items:center; flex-shrink:0;";
  modes.forEach(m => {
    const btn = document.createElement("button");
    btn.id = m.id;
    btn.className = "btn btn-ghost";
    btn.style.cssText = "padding:5px 10px; font-size:12px;";
    btn.textContent = m.label;
    btn.onclick = () => {
      selectedTool = m.tool;
      selectedTile = null;
      document.querySelectorAll("[id^='mode-']").forEach(b => b.classList.remove("active-tool"));
      btn.classList.add("active-tool");
      updateTilePanel();
    };
    modeBar.appendChild(btn);
  });
  toolbar.appendChild(modeBar);

  // Separator
  const sep = document.createElement("div");
  sep.style.cssText = "width:1px; background:#30363d; align-self:stretch; margin:0 4px;";
  toolbar.appendChild(sep);

  // Tile kategorileri
  const tilePanel = document.createElement("div");
  tilePanel.id = "tile-panel";
  tilePanel.style.cssText = "display:flex; gap:4px; flex-wrap:wrap; align-items:center; flex:1;";
  toolbar.appendChild(tilePanel);

  updateTilePanel();

  // Stil
  const style = document.createElement("style");
  style.textContent = `
    .active-tool { background:#1f6feb !important; color:#fff !important; border-color:#58a6ff !important; }
    .tile-btn    { background:#21262d; border:1px solid #30363d; border-radius:6px; color:#e6edf3;
                   padding:4px 8px; font-size:11px; cursor:pointer; transition:all 0.1s; white-space:nowrap; }
    .tile-btn:hover { border-color:#58a6ff; background:#1c2333; }
    .tile-btn.selected { background:#1f6feb; border-color:#58a6ff; color:#fff; }
    .tile-cat    { font-size:10px; color:#8b949e; padding:0 4px; font-weight:600; text-transform:uppercase; }
    @keyframes slideIn { from { transform:translateX(20px); opacity:0; } to { transform:translateX(0); opacity:1; } }
  `;
  document.head.appendChild(style);
}

function updateTilePanel() {
  const panel = document.getElementById("tile-panel");
  if (!panel) return;
  panel.innerHTML = "";

  if (selectedTool !== "build") {
    const hint = document.createElement("span");
    hint.style.cssText = "font-size:12px; color:#484f58; padding:0 8px;";
    hint.textContent = selectedTool === "demolish" ? "Yıkmak istediğin tile'a tıkla"
                     : selectedTool === "fund"     ? "Fon binasına tıkla"
                     : "Haritayı sürükle";
    panel.appendChild(hint);
    return;
  }

  Object.entries(TILE_CATEGORIES).forEach(([cat, types]) => {
    const catEl = document.createElement("span");
    catEl.className = "tile-cat";
    catEl.textContent = cat;
    panel.appendChild(catEl);

    types.forEach(type => {
      const def = TILES[type];
      const btn = document.createElement("button");
      btn.className = "tile-btn";
      btn.title = `${def.label} — ${def.cost.toLocaleString()}₺`;
      btn.innerHTML = `${def.icon} ${def.label} <span style="color:#58a6ff">${def.cost.toLocaleString()}₺</span>`;
      btn.onclick = () => {
        selectedTile = type;
        document.querySelectorAll(".tile-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      };
      panel.appendChild(btn);
    });
  });

  // Fon binası
  const fundDef = TILES["fund"];
  const fundBtn = document.createElement("button");
  fundBtn.className = "tile-btn";
  fundBtn.title = "Fon Binası — Ücretsiz (sadece bir tane)";
  fundBtn.innerHTML = `${fundDef.icon} Fon Binası <span style="color:#3fb950">Ücretsiz</span>`;
  fundBtn.onclick = () => {
    selectedTile = "fund";
    document.querySelectorAll(".tile-btn").forEach(b => b.classList.remove("selected"));
    fundBtn.classList.add("selected");
  };
  panel.appendChild(fundBtn);
}

// ── MODAL SİSTEMİ ─────────────────────────────────────────────────────────────
function showModal(title, bodyHtml, onConfirm) {
  let overlay = document.getElementById("game-modal-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "game-modal-overlay";
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.7);
      display: flex; align-items: center; justify-content: center;
      z-index: 200; padding: 1rem;
    `;
    document.body.appendChild(overlay);
  }
  overlay.style.display = "flex";
  overlay.innerHTML = `
    <div style="background:#161b22; border:1px solid #30363d; border-radius:10px;
      padding:1.5rem; max-width:420px; width:100%; max-height:90vh; overflow-y:auto;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
        <div style="font-weight:600; font-size:15px;">${title}</div>
        <button id="modal-close" style="background:none; border:none; color:#8b949e; cursor:pointer; font-size:18px; padding:0 4px;">✕</button>
      </div>
      <div id="modal-body">${bodyHtml}</div>
    </div>
  `;
  overlay.querySelector("#modal-close").onclick = closeModal;
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
}

function closeModal() {
  const overlay = document.getElementById("game-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3000);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function canPlaceHere(x, y) {
  if (!gameState) return false;
  const gs = gameState.gridSize || 20;
  if (x < 0 || y < 0 || x >= gs || y >= gs) return false;
  return !gameState.tiles?.[`${x},${y}`];
}

function getPlayerColor(uid) {
  return roomData?.players?.[uid]?.color || "#8b949e";
}

function shadeColor(hex, amount) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const clamp = v => Math.max(0,Math.min(255,v));
  return `rgb(${clamp(r+amount)},${clamp(g+amount)},${clamp(b+amount)})`;
}
