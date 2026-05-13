// game.js — CityHive Oyun Motoru
// window.initGame(roomId, roomData, currentUser) ile başlatılır

import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  push,
  onValue,
  off,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

// ─────────────────────────────────────────
// YAPILAR TANIMI
// ─────────────────────────────────────────
const BUILDINGS = {
  // Konut
  house:       { label: "Konut",         icon: "🏠", cost: 2000,  cat: "residential", pop: 20,  happiness: 2,  income: 100 },
  apartment:   { label: "Apartman",      icon: "🏢", cost: 8000,  cat: "residential", pop: 80,  happiness: 1,  income: 350 },
  villa:       { label: "Villa",         icon: "🏡", cost: 5000,  cat: "residential", pop: 10,  happiness: 5,  income: 200 },
  // Ticaret
  shop:        { label: "Mağaza",        icon: "🏪", cost: 3000,  cat: "commercial",  pop: 0,   happiness: 3,  income: 300 },
  office:      { label: "Ofis",          icon: "🏬", cost: 6000,  cat: "commercial",  pop: 0,   happiness: 1,  income: 600 },
  market:      { label: "Market",        icon: "🛒", cost: 4000,  cat: "commercial",  pop: 0,   happiness: 4,  income: 400 },
  // Kamu
  park:        { label: "Park",          icon: "🌳", cost: 1500,  cat: "public",      pop: 0,   happiness: 8,  income: 0   },
  hospital:    { label: "Hastane",       icon: "🏥", cost: 12000, cat: "public",      pop: 0,   happiness: 10, income: 0   },
  school:      { label: "Okul",          icon: "🏫", cost: 7000,  cat: "public",      pop: 0,   happiness: 7,  income: 0   },
  firestation: { label: "İtfaiye",       icon: "🚒", cost: 5000,  cat: "public",      pop: 0,   happiness: 4,  income: 0   },
  police:      { label: "Karakol",       icon: "🚔", cost: 5000,  cat: "public",      pop: 0,   happiness: 3,  income: 0   },
  // Altyapı
  road:        { label: "Yol",           icon: "🛤️",  cost: 500,   cat: "infra",       pop: 0,   happiness: 1,  income: 0   },
  powerplant:  { label: "Santral",       icon: "⚡", cost: 15000, cat: "infra",       pop: 0,   happiness: -2, income: 0   },
  waterworks:  { label: "Su Tesisi",     icon: "💧", cost: 10000, cat: "infra",       pop: 0,   happiness: 3,  income: 0   },
  // Özel
  fund:        { label: "Fon Binası",    icon: "🏦", cost: 20000, cat: "special",     pop: 0,   happiness: 2,  income: 0, unique: true },
};

const TILE_SIZE = 60;
const GRID_COLS_INIT = 10;
const GRID_ROWS_INIT = 10;
const EXPAND_COST = 50000;
const EXPAND_TILES = 2; // Her genişlemede her yönde +2 tile
const STARTING_BUDGET = 50000;
const PLAYER_INCOME_INTERVAL = 30000; // 30 saniye

// ─────────────────────────────────────────
// DURUM
// ─────────────────────────────────────────
let db, roomId, me, roomData;
let gameState = null;
let unsubGame = null;
let selectedBuilding = null;
let mode = "build"; // build | demolish
let isDragging = false;
let dragStart = null;
let cameraX = 0, cameraY = 0;
let scale = 1;
let gridCols, gridRows;
let canvas, ctx;
let pendingApprovals = {};
let demolishApprovalUnsub = null;
let incomeTimer = null;
let fundModalOpen = false;
let expandMenuOpen = false;

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
window.initGame = async function(rid, rd, user) {
  roomId = rid;
  roomData = rd;
  me = user;
  db = getDatabase(getApp());

  buildGameUI();
  setupCanvas();
  subscribeGameState();
  startIncomeLoop();
};

// ─────────────────────────────────────────
// UI İNŞASI
// ─────────────────────────────────────────
function buildGameUI() {
  // Üst bar stats
  const statsBar = document.getElementById("game-stats");
  statsBar.innerHTML = `
    <span title="Bütçen">💰 <span id="stat-my-budget">0</span></span>
    <span title="Nüfus">👥 <span id="stat-pop">0</span></span>
    <span title="Mutluluk">😊 <span id="stat-happy">0</span>%</span>
    <span title="Şehir Fonu">🏦 <span id="stat-fund">0</span></span>
  `;

  // Araç çubuğu
  const toolbar = document.getElementById("game-toolbar");
  toolbar.innerHTML = `
    <div id="toolbar-inner" style="display:flex;gap:0.5rem;align-items:center;width:100%;flex-wrap:wrap;">

      <!-- Mod butonları -->
      <div style="display:flex;gap:4px;margin-right:0.5rem;">
        <button id="btn-mode-build" class="btn btn-primary" style="font-size:12px;padding:0.4rem 0.75rem;" onclick="setMode('build')">🔨 İnşa</button>
        <button id="btn-mode-demolish" class="btn btn-ghost" style="font-size:12px;padding:0.4rem 0.75rem;" onclick="setMode('demolish')">💥 Yıkım</button>
      </div>

      <div style="height:28px;width:1px;background:var(--border);"></div>

      <!-- Kategori filtreleri -->
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        ${["all","residential","commercial","public","infra","special"].map(cat => `
          <button class="btn btn-ghost cat-btn" data-cat="${cat}" style="font-size:11px;padding:0.3rem 0.6rem;"
            onclick="filterCat('${cat}')">${catLabel(cat)}</button>
        `).join("")}
      </div>

      <div style="height:28px;width:1px;background:var(--border);"></div>

      <!-- Bina seçici -->
      <div id="building-picker" style="display:flex;gap:4px;flex-wrap:wrap;"></div>

      <div style="flex:1;"></div>

      <!-- Fon Binası butonu -->
      <button id="btn-fund" class="btn btn-ghost" style="font-size:12px;padding:0.4rem 0.75rem;" onclick="openFundModal()">🏦 Fon</button>

      <!-- Kaydet -->
      <button id="btn-save" class="btn btn-ghost" style="font-size:12px;padding:0.4rem 0.75rem;" onclick="saveGame()">💾 Kaydet</button>

    </div>

    <!-- Seçili bina bilgisi -->
    <div id="selected-info" style="width:100%;margin-top:4px;font-size:11px;color:var(--text2);display:none;"></div>
  `;

  filterCat("all");

  // Grid kenar genişletme butonları
  const overlay = document.getElementById("game-ui-overlay");
  overlay.innerHTML = `
    <button id="expand-top"    class="expand-btn" style="top:8px;left:50%;transform:translateX(-50%);"    onclick="openExpandMenu('top')">+</button>
    <button id="expand-bottom" class="expand-btn" style="bottom:8px;left:50%;transform:translateX(-50%);" onclick="openExpandMenu('bottom')">+</button>
    <button id="expand-left"   class="expand-btn" style="left:8px;top:50%;transform:translateY(-50%);"    onclick="openExpandMenu('left')">+</button>
    <button id="expand-right"  class="expand-btn" style="right:8px;top:50%;transform:translateY(-50%);"   onclick="openExpandMenu('right')">+</button>
  `;

  // Ek CSS
  injectCSS();

  // Fon modalı
  document.body.insertAdjacentHTML("beforeend", `
    <div id="fund-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);
      align-items:center;justify-content:center;z-index:200;padding:1rem;">
      <div class="card" style="width:100%;max-width:420px;">
        <div style="font-weight:600;font-size:15px;margin-bottom:1rem;">🏦 Fon Binası</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:1rem;">
          Şehir fonu: <strong id="fund-city-balance" style="color:var(--accent);">0 ₺</strong>
        </div>

        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:1rem;">
          <div style="padding:0.75rem 1rem;background:var(--bg3);font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:0.05em;">
            Para Transferi
          </div>
          <div style="padding:1rem;">
            <div class="input-group" style="margin-bottom:0.5rem;">
              <label>Alıcı</label>
              <select id="transfer-target" style="width:100%;"></select>
            </div>
            <div class="input-group" style="margin-bottom:0.5rem;">
              <label>Miktar (₺)</label>
              <input type="number" id="transfer-amount" placeholder="1000" min="100" style="width:100%;" />
            </div>
            <div style="display:flex;gap:0.5rem;">
              <button class="btn btn-primary" style="flex:1;" onclick="doTransfer('player')">Oyuncuya Gönder</button>
              <button class="btn btn-ghost" style="flex:1;" onclick="doTransfer('fund')">Fona Yatır</button>
            </div>
          </div>
        </div>

        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:1rem;">
          <div style="padding:0.75rem 1rem;background:var(--bg3);font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:0.05em;">
            İşlem Geçmişi
          </div>
          <div id="fund-history" style="max-height:160px;overflow-y:auto;padding:0.5rem 1rem;font-size:12px;color:var(--text2);">
          </div>
        </div>

        <button class="btn btn-ghost btn-full" onclick="closeFundModal()">Kapat</button>
      </div>
    </div>
  `);

  // Genişletme menüsü
  document.body.insertAdjacentHTML("beforeend", `
    <div id="expand-menu" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);
      align-items:center;justify-content:center;z-index:200;padding:1rem;">
      <div class="card" style="width:100%;max-width:360px;">
        <div style="font-weight:600;font-size:15px;margin-bottom:0.5rem;">📐 Şehri Genişlet</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:1rem;">
          Her genişletme +${EXPAND_TILES} satır/sütun ekler.<br>
          Maliyet: <strong style="color:var(--accent);">${EXPAND_COST.toLocaleString()} ₺</strong> (Şehir Fonu'ndan)
        </div>
        <div id="expand-fund-status" style="font-size:13px;margin-bottom:1rem;"></div>
        <div style="display:flex;gap:0.5rem;">
          <button class="btn btn-primary" style="flex:1;" id="btn-confirm-expand" onclick="confirmExpand()">Genişlet</button>
          <button class="btn btn-ghost" style="flex:1;" onclick="closeExpandMenu()">İptal</button>
        </div>
      </div>
    </div>
  `);

  // Onay modalı (yıkım izni)
  document.body.insertAdjacentHTML("beforeend", `
    <div id="approval-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);
      align-items:center;justify-content:center;z-index:300;padding:1rem;">
      <div class="card" style="width:100%;max-width:360px;">
        <div style="font-weight:600;font-size:15px;margin-bottom:0.5rem;">💥 Yıkım Onayı</div>
        <div id="approval-text" style="font-size:13px;color:var(--text2);margin-bottom:1rem;"></div>
        <div style="display:flex;gap:0.5rem;">
          <button class="btn btn-danger" style="flex:1;" id="btn-approve-demolish" onclick="respondDemolish(true)">İzin Ver</button>
          <button class="btn btn-ghost" style="flex:1;" id="btn-deny-demolish" onclick="respondDemolish(false)">Reddet</button>
        </div>
      </div>
    </div>
  `);
}

function injectCSS() {
  const style = document.createElement("style");
  style.textContent = `
    .expand-btn {
      position:absolute;
      pointer-events:all;
      background:var(--bg2);
      border:1px solid var(--border);
      color:var(--accent);
      font-size:20px;
      font-weight:700;
      width:36px;height:36px;
      border-radius:50%;
      cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      transition:background 0.15s,border-color 0.15s;
      line-height:1;
      padding:0;
    }
    .expand-btn:hover { background:var(--bg3); border-color:var(--accent2); }
    .building-btn {
      background:var(--bg3);
      border:1px solid var(--border);
      border-radius:6px;
      padding:4px 8px;
      cursor:pointer;
      font-size:12px;
      color:var(--text);
      transition:border-color 0.15s, background 0.15s;
      white-space:nowrap;
    }
    .building-btn:hover { border-color:var(--accent2); background:var(--bg2); }
    .building-btn.selected { border-color:var(--accent); background:var(--accent2); color:#fff; }
    .cat-btn.active { background:var(--accent2); color:#fff; border-color:var(--accent2); }
  `;
  document.head.appendChild(style);
}

function catLabel(cat) {
  return { all:"Tümü", residential:"Konut", commercial:"Ticaret", public:"Kamu", infra:"Altyapı", special:"Özel" }[cat] || cat;
}

window.filterCat = function(cat) {
  document.querySelectorAll(".cat-btn").forEach(b => b.classList.toggle("active", b.dataset.cat === cat));
  const picker = document.getElementById("building-picker");
  picker.innerHTML = "";
  Object.entries(BUILDINGS).forEach(([key, b]) => {
    if (cat !== "all" && b.cat !== cat) return;
    const btn = document.createElement("button");
    btn.className = "building-btn" + (selectedBuilding === key ? " selected" : "");
    btn.dataset.key = key;
    btn.title = `${b.label} — ${b.cost.toLocaleString()}₺`;
    btn.innerHTML = `${b.icon} ${b.label}`;
    btn.onclick = () => selectBuilding(key);
    picker.appendChild(btn);
  });
};

window.setMode = function(m) {
  mode = m;
  selectedBuilding = null;
  document.getElementById("btn-mode-build").className = "btn " + (m === "build" ? "btn-primary" : "btn-ghost");
  document.getElementById("btn-mode-demolish").className = "btn " + (m === "demolish" ? "btn-danger" : "btn-ghost");
  document.getElementById("selected-info").style.display = "none";
  document.querySelectorAll(".building-btn").forEach(b => b.classList.remove("selected"));
  canvas.style.cursor = m === "demolish" ? "crosshair" : "default";
};

function selectBuilding(key) {
  if (mode !== "build") setMode("build");
  selectedBuilding = key;
  document.querySelectorAll(".building-btn").forEach(b =>
    b.classList.toggle("selected", b.dataset.key === key)
  );
  const b = BUILDINGS[key];
  const info = document.getElementById("selected-info");
  info.style.display = "block";
  info.innerHTML = `${b.icon} <strong>${b.label}</strong> — Maliyet: <strong>${b.cost.toLocaleString()}₺</strong>${b.pop ? ` · Nüfus: +${b.pop}` : ""}${b.happiness ? ` · Mutluluk: ${b.happiness > 0 ? "+" : ""}${b.happiness}` : ""}${b.income ? ` · Gelir: +${b.income}₺/tur` : ""}`;
  canvas.style.cursor = "cell";
}

// ─────────────────────────────────────────
// CANVAS KURULUMU
// ─────────────────────────────────────────
function setupCanvas() {
  const container = document.getElementById("game-canvas-container");
  canvas = document.getElementById("game-canvas");
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // Fare olayları
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("click", onCanvasClick);

  // Dokunmatik
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);
}

function resizeCanvas() {
  const container = document.getElementById("game-canvas-container");
  canvas.width = container.offsetWidth;
  canvas.height = container.offsetHeight;
  renderGame();
}

// ─────────────────────────────────────────
// FIREBASE SUBSCRIBE
// ─────────────────────────────────────────
function subscribeGameState() {
  if (unsubGame) unsubGame();
  const gsRef = ref(db, `rooms/${roomId}/gameState`);
  const fn = onValue(gsRef, snap => {
    if (!snap.exists()) return;
    gameState = snap.val();
    gridCols = gameState.gridCols || GRID_COLS_INIT;
    gridRows = gameState.gridRows || GRID_ROWS_INIT;
    updateStatsBar();
    renderGame();
    checkDemolishApprovals();
  });
  unsubGame = () => off(gsRef, "value", fn);
}

function updateStatsBar() {
  if (!gameState) return;
  const myBudget = gameState.budgets?.[me.uid] ?? 0;
  const pop = calcStat("pop");
  const happiness = calcStat("happiness");
  const fund = gameState.cityFund ?? 0;
  document.getElementById("stat-my-budget").textContent = myBudget.toLocaleString() + " ₺";
  document.getElementById("stat-pop").textContent = pop.toLocaleString();
  document.getElementById("stat-happy").textContent = happiness;
  document.getElementById("stat-fund").textContent = fund.toLocaleString() + " ₺";
}

function calcStat(stat) {
  if (!gameState?.grid) return stat === "happiness" ? 80 : 0;
  let val = stat === "happiness" ? 80 : 0;
  Object.values(gameState.grid).forEach(tile => {
    const b = BUILDINGS[tile.type];
    if (!b) return;
    if (stat === "pop") val += b.pop || 0;
    if (stat === "happiness") val += b.happiness || 0;
  });
  return Math.max(0, Math.min(100, val));
}

// ─────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────
function renderGame() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cols = gridCols || GRID_COLS_INIT;
  const rows = gridRows || GRID_ROWS_INIT;

  // Arka plan
  ctx.fillStyle = "#0a0f14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(cameraX + canvas.width / 2, cameraY + canvas.height / 2);
  ctx.scale(scale, scale);
  const offsetX = -(cols * TILE_SIZE) / 2;
  const offsetY = -(rows * TILE_SIZE) / 2;
  ctx.translate(offsetX, offsetY);

  // Grid
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * TILE_SIZE;
      const y = r * TILE_SIZE;
      ctx.fillStyle = (r + c) % 2 === 0 ? "#141a21" : "#111820";
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      ctx.strokeStyle = "#1e2833";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
    }
  }

  // Binalar
  if (gameState?.grid) {
    Object.entries(gameState.grid).forEach(([key, tile]) => {
      const [r, c] = key.split("_").map(Number);
      const b = BUILDINGS[tile.type];
      if (!b) return;
      const x = c * TILE_SIZE;
      const y = r * TILE_SIZE;
      const isOwn = tile.owner === me.uid;
      const ownerColor = roomData?.players?.[tile.owner]?.color || "#888";

      // Zemin
      ctx.fillStyle = isOwn ? "#1a2e1a" : "#1a1a2e";
      ctx.fillRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);

      // Sahip rengi kenarlık
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);

      // Emoji bina
      ctx.font = `${TILE_SIZE * 0.5}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.icon, x + TILE_SIZE / 2, y + TILE_SIZE / 2);
    });
  }

  // Grid sınırı
  ctx.strokeStyle = "#58a6ff44";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, cols * TILE_SIZE, rows * TILE_SIZE);

  ctx.restore();
}

// ─────────────────────────────────────────
// FARE / DOKUNMATIK
// ─────────────────────────────────────────
let lastMouse = null;

function onMouseDown(e) {
  isDragging = false;
  dragStart = { x: e.clientX, y: e.clientY };
  lastMouse = { x: e.clientX, y: e.clientY };
}

function onMouseMove(e) {
  if (!dragStart) return;
  const dx = e.clientX - lastMouse.x;
  const dy = e.clientY - lastMouse.y;
  const dist = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
  if (dist > 5) isDragging = true;
  if (isDragging) {
    cameraX += dx;
    cameraY += dy;
    renderGame();
  }
  lastMouse = { x: e.clientX, y: e.clientY };
}

function onMouseUp(e) {
  dragStart = null;
  lastMouse = null;
}

function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  scale = Math.max(0.3, Math.min(3, scale * delta));
  renderGame();
}

function onCanvasClick(e) {
  if (isDragging) return;
  const tile = screenToTile(e.clientX, e.clientY);
  if (!tile) return;
  if (mode === "build" && selectedBuilding) {
    handleBuild(tile.row, tile.col);
  } else if (mode === "demolish") {
    handleDemolish(tile.row, tile.col);
  }
}

// Dokunmatik panning
let lastTouch = null;
function onTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    isDragging = false;
  }
}
function onTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1 && lastTouch) {
    const dx = e.touches[0].clientX - lastTouch.x;
    const dy = e.touches[0].clientY - lastTouch.y;
    cameraX += dx;
    cameraY += dy;
    lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    isDragging = true;
    renderGame();
  }
}
function onTouchEnd(e) {
  if (!isDragging && dragStart) {
    const tile = screenToTile(dragStart.x, dragStart.y);
    if (tile) {
      if (mode === "build" && selectedBuilding) handleBuild(tile.row, tile.col);
      else if (mode === "demolish") handleDemolish(tile.row, tile.col);
    }
  }
  lastTouch = null;
  dragStart = null;
  isDragging = false;
}

function screenToTile(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  const cols = gridCols || GRID_COLS_INIT;
  const rows = gridRows || GRID_ROWS_INIT;
  const wx = (sx - rect.left - cameraX - canvas.width / 2) / scale + (cols * TILE_SIZE) / 2;
  const wy = (sy - rect.top - cameraY - canvas.height / 2) / scale + (rows * TILE_SIZE) / 2;
  const col = Math.floor(wx / TILE_SIZE);
  const row = Math.floor(wy / TILE_SIZE);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  return { row, col };
}

// ─────────────────────────────────────────
// İNŞAAT
// ─────────────────────────────────────────
async function handleBuild(row, col) {
  if (!gameState || !selectedBuilding) return;
  const b = BUILDINGS[selectedBuilding];
  const key = `${row}_${col}`;

  if (gameState.grid?.[key]) {
    showToast("Bu alanda zaten bir yapı var!", "error"); return;
  }

  const myBudget = gameState.budgets?.[me.uid] ?? 0;
  if (myBudget < b.cost) {
    showToast(`Yetersiz bütçe! Gereken: ${b.cost.toLocaleString()}₺`, "error"); return;
  }

  // Unique bina kontrolü (Fon Binası)
  if (b.unique) {
    const hasUnique = Object.values(gameState.grid || {}).some(t => t.type === selectedBuilding);
    if (hasUnique) {
      showToast("Bu yapıdan şehirde sadece bir tane olabilir!", "error"); return;
    }
  }

  // Firebase güncelleme
  const updates = {};
  updates[`rooms/${roomId}/gameState/grid/${key}`] = {
    type: selectedBuilding,
    owner: me.uid,
    builtAt: serverTimestamp()
  };
  updates[`rooms/${roomId}/gameState/budgets/${me.uid}`] = myBudget - b.cost;
  updates[`rooms/${roomId}/gameState/lastAction`] = {
    by: me.uid,
    action: "build",
    building: selectedBuilding,
    tile: key,
    at: serverTimestamp()
  };

  try {
    await update(ref(db), updates);
    showToast(`${b.icon} ${b.label} inşa edildi!`, "success");
  } catch (err) {
    showToast("Hata: " + err.message, "error");
  }
}

// ─────────────────────────────────────────
// YIKIM
// ─────────────────────────────────────────
async function handleDemolish(row, col) {
  if (!gameState) return;
  const key = `${row}_${col}`;
  const tile = gameState.grid?.[key];
  if (!tile) {
    showToast("Bu alanda yıkılacak bir yapı yok.", "error"); return;
  }
  const b = BUILDINGS[tile.type];

  if (tile.owner === me.uid) {
    // Kendi yapısı — direkt yık
    const updates = {};
    updates[`rooms/${roomId}/gameState/grid/${key}`] = null;
    updates[`rooms/${roomId}/gameState/budgets/${me.uid}`] = (gameState.budgets?.[me.uid] ?? 0) + Math.floor(b.cost * 0.5);
    updates[`rooms/${roomId}/gameState/lastAction`] = {
      by: me.uid, action: "demolish", building: tile.type, tile: key, at: serverTimestamp()
    };
    await update(ref(db), updates);
    showToast(`${b.icon} Yapı yıkıldı! +${Math.floor(b.cost*0.5).toLocaleString()}₺ iade`, "success");
  } else {
    // Başka oyuncunun yapısı — onay iste
    await requestDemolishApproval(key, tile);
  }
}

async function requestDemolishApproval(tileKey, tile) {
  const b = BUILDINGS[tile.type];
  const approvalRef = push(ref(db, `rooms/${roomId}/demolishRequests`));
  await set(approvalRef, {
    requester: me.uid,
    requesterName: me.displayName,
    owner: tile.owner,
    tileKey,
    buildingType: tile.type,
    buildingLabel: b.label,
    buildingIcon: b.icon,
    status: "pending",
    at: serverTimestamp()
  });
  showToast(`${b.icon} Yıkım izni istendi! Yapı sahibi onaylarsı bekle.`, "info");
}

function checkDemolishApprovals() {
  // Bekleyen onayları dinle
  if (demolishApprovalUnsub) return;
  const reqRef = ref(db, `rooms/${roomId}/demolishRequests`);
  const fn = onValue(reqRef, snap => {
    if (!snap.exists()) return;
    snap.forEach(child => {
      const req = child.val();
      if (req.owner === me.uid && req.status === "pending") {
        showDemolishApproval(child.key, req);
      }
    });
  });
  demolishApprovalUnsub = () => off(reqRef, "value", fn);
}

let currentApprovalId = null;
let currentApprovalData = null;

function showDemolishApproval(id, req) {
  currentApprovalId = id;
  currentApprovalData = req;
  const modal = document.getElementById("approval-modal");
  document.getElementById("approval-text").innerHTML =
    `<strong>${escHtml(req.requesterName)}</strong> oyuncusu senin <strong>${req.buildingIcon} ${req.buildingLabel}</strong> yapını yıkmak istiyor. İzin veriyor musun?`;
  modal.style.display = "flex";
}

window.respondDemolish = async function(approved) {
  if (!currentApprovalId) return;
  document.getElementById("approval-modal").style.display = "none";

  const reqRef = ref(db, `rooms/${roomId}/demolishRequests/${currentApprovalId}`);
  if (approved && currentApprovalData) {
    const { tileKey, buildingType, requester } = currentApprovalData;
    const b = BUILDINGS[buildingType];
    const updates = {};
    updates[`rooms/${roomId}/gameState/grid/${tileKey}`] = null;
    updates[`rooms/${roomId}/gameState/budgets/${requester}`] =
      (gameState?.budgets?.[requester] ?? 0) + Math.floor(b.cost * 0.5);
    updates[`rooms/${roomId}/demolishRequests/${currentApprovalId}/status`] = "approved";
    await update(ref(db), updates);
    showToast("Yıkım izni verildi.", "success");
  } else {
    await update(reqRef, { status: "denied" });
    showToast("Yıkım reddedildi.", "info");
  }
  currentApprovalId = null;
  currentApprovalData = null;
};

// ─────────────────────────────────────────
// FON BİNASI MODALI
// ─────────────────────────────────────────
window.openFundModal = function() {
  if (!gameState?.grid) {
    showToast("Önce şehirde bir Fon Binası inşa edin!", "error"); return;
  }
  const hasFund = Object.values(gameState.grid).some(t => t.type === "fund");
  if (!hasFund) {
    showToast("Fon işlemleri için şehirde Fon Binası (🏦) olmalı!", "error"); return;
  }

  fundModalOpen = true;
  document.getElementById("fund-city-balance").textContent =
    (gameState.cityFund ?? 0).toLocaleString() + " ₺";

  // Oyuncu listesi doldur
  const sel = document.getElementById("transfer-target");
  sel.innerHTML = "";
  Object.entries(roomData?.players || {}).forEach(([uid, p]) => {
    if (uid === me.uid) return;
    const opt = document.createElement("option");
    opt.value = uid;
    opt.textContent = `${p.name} (${(gameState.budgets?.[uid] ?? 0).toLocaleString()}₺)`;
    sel.appendChild(opt);
  });

  // İşlem geçmişi
  const hist = document.getElementById("fund-history");
  const logs = gameState.fundLog ? Object.values(gameState.fundLog).slice(-20).reverse() : [];
  hist.innerHTML = logs.length ? logs.map(l =>
    `<div style="padding:3px 0;border-bottom:1px solid var(--border);">${escHtml(l.text)}</div>`
  ).join("") : `<div style="color:var(--text2);">Henüz işlem yok</div>`;

  document.getElementById("fund-modal").style.display = "flex";
};

window.closeFundModal = function() {
  document.getElementById("fund-modal").style.display = "none";
  fundModalOpen = false;
};

window.doTransfer = async function(direction) {
  const amount = parseInt(document.getElementById("transfer-amount").value);
  if (!amount || amount < 100) { showToast("Geçersiz miktar (min 100₺)", "error"); return; }

  const updates = {};

  if (direction === "player") {
    // Benden seçili oyuncuya
    const targetUid = document.getElementById("transfer-target").value;
    const myBudget = gameState?.budgets?.[me.uid] ?? 0;
    if (myBudget < amount) { showToast("Yetersiz bütçe!", "error"); return; }
    const targetBudget = gameState?.budgets?.[targetUid] ?? 0;
    updates[`rooms/${roomId}/gameState/budgets/${me.uid}`] = myBudget - amount;
    updates[`rooms/${roomId}/gameState/budgets/${targetUid}`] = targetBudget + amount;
    const logKey = Date.now();
    updates[`rooms/${roomId}/gameState/fundLog/${logKey}`] = {
      text: `${me.displayName} → ${roomData?.players?.[targetUid]?.name}: ${amount.toLocaleString()}₺`,
      at: logKey
    };
    await update(ref(db), updates);
    showToast(`${amount.toLocaleString()}₺ transfer edildi!`, "success");
    closeFundModal();

  } else if (direction === "fund") {
    // Şehir fonuna yatır
    const myBudget = gameState?.budgets?.[me.uid] ?? 0;
    if (myBudget < amount) { showToast("Yetersiz bütçe!", "error"); return; }
    const fundBal = gameState?.cityFund ?? 0;
    updates[`rooms/${roomId}/gameState/budgets/${me.uid}`] = myBudget - amount;
    updates[`rooms/${roomId}/gameState/cityFund`] = fundBal + amount;
    const logKey = Date.now();
    updates[`rooms/${roomId}/gameState/fundLog/${logKey}`] = {
      text: `${me.displayName} şehir fonuna ${amount.toLocaleString()}₺ yatırdı`,
      at: logKey
    };
    await update(ref(db), updates);
    showToast(`${amount.toLocaleString()}₺ şehir fonuna yatırıldı!`, "success");
    closeFundModal();
  }
};

// ─────────────────────────────────────────
// ŞEHİR GENİŞLETME
// ─────────────────────────────────────────
let expandDirection = null;

window.openExpandMenu = function(direction) {
  expandDirection = direction;
  const fundBal = gameState?.cityFund ?? 0;
  const canAfford = fundBal >= EXPAND_COST;
  const statusEl = document.getElementById("expand-fund-status");
  const btnConfirm = document.getElementById("btn-confirm-expand");
  statusEl.innerHTML = `Mevcut şehir fonu: <strong style="color:${canAfford?"var(--success)":"var(--danger)"};">${fundBal.toLocaleString()}₺</strong>`;
  btnConfirm.disabled = !canAfford;
  document.getElementById("expand-menu").style.display = "flex";
};

window.closeExpandMenu = function() {
  document.getElementById("expand-menu").style.display = "none";
  expandDirection = null;
};

window.confirmExpand = async function() {
  const fundBal = gameState?.cityFund ?? 0;
  if (fundBal < EXPAND_COST) { showToast("Yeterli fon yok!", "error"); return; }

  const newCols = (gameState.gridCols || GRID_COLS_INIT) + (["left","right"].includes(expandDirection) ? EXPAND_TILES : 0);
  const newRows = (gameState.gridRows || GRID_ROWS_INIT) + (["top","bottom"].includes(expandDirection) ? EXPAND_TILES : 0);

  const updates = {};
  updates[`rooms/${roomId}/gameState/cityFund`] = fundBal - EXPAND_COST;
  updates[`rooms/${roomId}/gameState/gridCols`] = newCols;
  updates[`rooms/${roomId}/gameState/gridRows`] = newRows;
  updates[`rooms/${roomId}/gameState/lastAction`] = {
    by: me.uid, action: "expand", direction: expandDirection, at: serverTimestamp()
  };

  // Sol/üst genişlemede mevcut grid key'lerini kaydır
  if (expandDirection === "left" || expandDirection === "top") {
    const grid = gameState.grid || {};
    const newGrid = {};
    Object.entries(grid).forEach(([key, tile]) => {
      const [r, c] = key.split("_").map(Number);
      const newR = expandDirection === "top" ? r + EXPAND_TILES : r;
      const newC = expandDirection === "left" ? c + EXPAND_TILES : c;
      newGrid[`${newR}_${newC}`] = tile;
    });
    // Eski grid'i temizle
    Object.keys(grid).forEach(k => { updates[`rooms/${roomId}/gameState/grid/${k}`] = null; });
    Object.entries(newGrid).forEach(([k, v]) => { updates[`rooms/${roomId}/gameState/grid/${k}`] = v; });
  }

  await update(ref(db), updates);
  showToast(`Şehir genişletildi! (+${EXPAND_TILES} ${expandDirection === "left"||expandDirection==="right"?"sütun":"satır"})`, "success");
  closeExpandMenu();
};

// ─────────────────────────────────────────
// GELİR DÖNGÜSÜ
// ─────────────────────────────────────────
function startIncomeLoop() {
  if (incomeTimer) clearInterval(incomeTimer);
  incomeTimer = setInterval(distributeIncome, PLAYER_INCOME_INTERVAL);
}

async function distributeIncome() {
  if (!gameState || !gameState.grid) return;
  // Sadece host çalıştırır (race condition'ı önlemek için)
  if (roomData?.meta?.host !== me.uid) return;

  const incomes = {}; // uid -> total income
  Object.values(gameState.grid).forEach(tile => {
    const b = BUILDINGS[tile.type];
    if (!b || !b.income) return;
    incomes[tile.owner] = (incomes[tile.owner] || 0) + b.income;
  });

  const updates = {};
  Object.entries(incomes).forEach(([uid, amount]) => {
    const current = gameState.budgets?.[uid] ?? 0;
    updates[`rooms/${roomId}/gameState/budgets/${uid}`] = current + amount;
  });
  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates);
  }
}

// ─────────────────────────────────────────
// KAYDET
// ─────────────────────────────────────────
window.saveGame = async function() {
  try {
    await update(ref(db, `rooms/${roomId}/meta`), {
      lastSaved: serverTimestamp(),
      savedBy: me.uid
    });
    showToast("Oyun kaydedildi! 💾", "success");
  } catch(e) {
    showToast("Kayıt hatası: " + e.message, "error");
  }
};

// ─────────────────────────────────────────
// YARDIMCILAR
// ─────────────────────────────────────────
function showToast(msg, type = "info") {
  // app.js'deki toast fonksiyonunu kullan
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 3500);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// gameState başlangıcında budgets başlatılmamışsa ekle
async function ensurePlayerBudget() {
  if (!gameState?.budgets?.[me.uid]) {
    await update(ref(db, `rooms/${roomId}/gameState/budgets`), {
      [me.uid]: STARTING_BUDGET
    });
  }
}

// Firebase gameState ilk kez yüklendiğinde oyuncuyu ekle
const origSub = subscribeGameState;
subscribeGameState = function() {
  if (unsubGame) unsubGame();
  const gsRef = ref(db, `rooms/${roomId}/gameState`);
  const fn = onValue(gsRef, async snap => {
    if (!snap.exists()) return;
    gameState = snap.val();
    gridCols = gameState.gridCols || GRID_COLS_INIT;
    gridRows = gameState.gridRows || GRID_ROWS_INIT;
    await ensurePlayerBudget();
    updateStatsBar();
    renderGame();
    checkDemolishApprovals();
  });
  unsubGame = () => off(gsRef, "value", fn);
};
