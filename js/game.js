// game.js — İzometrik şehir builder oyun motoru

import {
  placeTile, finishBuilding, demolishOwn, requestDemolish, respondDemolish,
  transferToFund, transferFromFund, transferBetweenPlayers,
  addToExpansionFund, requestExpansion, voteExpansion,
  listenToGameState, EXPAND_COST, STARTING_BUDGET
} from "./firebase-manager.js";

// ── TILE TANIMLARI ────────────────────────────────────────────────────────────
export const TILES = {
  road_1x2way: { label:"Tek Şerit (2 Yön)", cost:150,  icon:"🛣️", color:"#4a4f57", isRoad:true, lanes:1, twoWay:true,  sidewalk:4 },
  road_1x1way: { label:"Tek Şerit (1 Yön)", cost:100,  icon:"→",  color:"#4a4f57", isRoad:true, lanes:1, twoWay:false, sidewalk:4 },
  road_2x2way: { label:"Çift Şerit (2 Yön)",cost:300,  icon:"🛣️", color:"#3e4349", isRoad:true, lanes:2, twoWay:true,  sidewalk:5 },
  road_2x1way: { label:"Çift Şerit (1 Yön)",cost:250,  icon:"⇒",  color:"#3e4349", isRoad:true, lanes:2, twoWay:false, sidewalk:5 },
  house:       { label:"Konut",       cost:1500,  icon:"🏠", color:"#4a9eff", w:1,h:1 },
  apartment:   { label:"Apartman",    cost:4000,  icon:"🏢", color:"#3a7fdd", w:1,h:1 },
  shop:        { label:"Dükkan",      cost:2000,  icon:"🏪", color:"#f4a300", w:1,h:1 },
  office:      { label:"Ofis",        cost:5000,  icon:"🏬", color:"#e0a000", w:1,h:1 },
  factory:     { label:"Fabrika",     cost:6000,  icon:"🏭", color:"#888",    w:1,h:1 },
  park:        { label:"Park",        cost:800,   icon:"🌳", color:"#2d8a4e", w:1,h:1 },
  hospital:    { label:"Hastane",     cost:8000,  icon:"🏥", color:"#e55",    w:1,h:1 },
  school:      { label:"Okul",        cost:5000,  icon:"🏫", color:"#a66",    w:1,h:1 },
  firestation: { label:"İtfaiye",     cost:4500,  icon:"🚒", color:"#c33",    w:1,h:1 },
  police:      { label:"Karakol",     cost:4500,  icon:"🚓", color:"#33c",    w:1,h:1 },
  stadium:     { label:"Stadyum",     cost:15000, icon:"🏟️", color:"#c8a000", w:2,h:2 },
  fund:        { label:"Fon Binası",  cost:0,     icon:"🏦", color:"#ffd700", w:1,h:1, unique:true },
};

const TILE_CATEGORIES = {
  "Yol":     ["road_1x2way","road_1x1way","road_2x2way","road_2x1way"],
  "Konut":   ["house","apartment"],
  "Ticaret": ["shop","office"],
  "Sanayi":  ["factory"],
  "Yeşil":   ["park"],
  "Kamu":    ["hospital","school","firestation","police","stadium"],
};

// ── SABİTLER ──────────────────────────────────────────────────────────────────
const TILE_W  = 64;
const TILE_H  = 32;
const TILE_TH = 20;

// ── STATE ─────────────────────────────────────────────────────────────────────
let roomId, myUser, roomData, gameState;
let unsubGS;
let canvas, ctx;
let camX = 0, camY = 0, scale = 1;
let dragging = false, dragStart = {x:0,y:0}, camStart = {x:0,y:0};
let selectedTool = null;
let selectedTile = null;
let roadRotation = 0;   // 0=EW(yatay), 1=NS(dikey)
let hoverCell    = null;
let buildQueue   = {};

// ── ARABA SİSTEMİ ─────────────────────────────────────────────────────────────
// Her araba: { id, gx, gy, rot, progress(0-1), speed, lane, dir, color, type }
// progress: tile içindeki ilerleme 0→1, sonra bir sonraki tile'a geçer
let cars = [];
let _carIdCounter = 0;

const CAR_COLORS = ["#e63946","#f4d03f","#2ecc71","#3498db","#9b59b6","#f39c12","#1abc9c","#e74c3c"];
const CAR_SPEED  = 0.008; // tile/frame

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

  unsubGS = listenToGameState(roomId, gs => {
    const prev = gameState;
    gameState  = gs;
    handleGameStateChange(prev, gs);
    syncCarsToRoads();
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

// ── KOORDINAT DÖNÜŞÜM ─────────────────────────────────────────────────────────
function isoToScreen(gx, gy) {
  return {
    sx: camX + (gx - gy) * (TILE_W/2) * scale,
    sy: camY + (gx + gy) * (TILE_H/2) * scale
  };
}

function screenToIso(sx, sy) {
  const rx = (sx - camX) / scale;
  const ry = (sy - camY) / scale;
  return {
    gx: Math.floor((rx/(TILE_W/2) + ry/(TILE_H/2)) / 2),
    gy: Math.floor((ry/(TILE_H/2) - rx/(TILE_W/2)) / 2)
  };
}

// ── RENDER LOOP ───────────────────────────────────────────────────────────────
function loop() {
  updateBuildQueues();
  updateCars();
  render();
  requestAnimationFrame(loop);
}

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
  drawMainRoad(gs);    // önce anayol arka plan
  drawGrid(gs);
  drawTiles(gs);
  drawCars();          // tile'lardan sonra
  drawHover(gs);
  drawEdgeButtons(gs);
}

// ── ANAYOL ────────────────────────────────────────────────────────────────────
// Grid ortasından geçen, gridSize boyunca uzanan 2 yönlü çift şeritli yol
// Yol rot=0 (EW) → grid'in Y ortasında, X=0 → X=gs boyunca uzanır
// Canvas'ta bu grid satırı yatay bir şerit oluşturur
const MAINROAD_ROW = null; // gameState.mainRoadRow'dan gelir

function drawMainRoad(gs) {
  const row = gameState?.mainRoadRow ?? Math.floor(gs / 2);
  // Anayolun grid dışına uzanan kısmı (sonsuzluk hissi için)
  const ext = 6; // her iki yönde 6 tile ekstra
  for (let x = -ext; x < gs + ext; x++) {
    drawRoadSegment(x, row, 0, { lanes:2, twoWay:true, sidewalk:5, color:"#3e4349" }, "mainroad");
  }
}

// ── GRID ──────────────────────────────────────────────────────────────────────
function drawGrid(gs) {
  ctx.save();
  const row = gameState?.mainRoadRow ?? Math.floor(gs / 2);
  for (let x = 0; x < gs; x++) {
    for (let y = 0; y < gs; y++) {
      if (y === row) continue; // anayol bu satırı kaplayacak
      const { sx, sy } = isoToScreen(x, y);
      drawDiamond(sx, sy, "#1a1f27", "#2d333b", 0.85);
    }
  }
  ctx.restore();
}

function drawDiamond(sx, sy, fill, stroke, alpha = 1) {
  const hw = TILE_W/2 * scale, hh = TILE_H/2 * scale;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(sx,      sy - hh);
  ctx.lineTo(sx + hw, sy);
  ctx.lineTo(sx,      sy + hh);
  ctx.lineTo(sx - hw, sy);
  ctx.closePath();
  if (fill)   { ctx.fillStyle = fill;     ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.5; ctx.stroke(); }
  ctx.globalAlpha = 1;
}

// ── TILE ÇİZİMİ ───────────────────────────────────────────────────────────────
function drawTiles(gs) {
  if (!gameState?.tiles) return;
  const entries = Object.entries(gameState.tiles).sort(([k1],[k2]) => {
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
  if (def.isRoad) {
    drawRoadSegment(gx, gy, tile.rotation ?? 0, def, tile.ownerId);
    return;
  }
  drawBuilding(gx, gy, tile, key, def);
}

// ── YÜKSEK YAPI ÇİZİMİ ───────────────────────────────────────────────────────
function drawBuilding(gx, gy, tile, key, def) {
  const { sx, sy } = isoToScreen(gx, gy);
  const progress = buildQueue[key]?.progress ?? 1;
  const tH = TILE_TH * progress * scale;
  const ownerColor = getPlayerColor(tile.ownerId);
  const hw = TILE_W/2 * scale, hh = TILE_H/2 * scale;

  ctx.globalAlpha = tile.building ? 0.6 + 0.4*progress : 1;

  // Sol yüz
  ctx.beginPath();
  ctx.moveTo(sx - hw, sy);
  ctx.lineTo(sx - hw, sy - tH);
  ctx.lineTo(sx,      sy + hh - tH);
  ctx.lineTo(sx,      sy + hh);
  ctx.closePath();
  ctx.fillStyle = shadeColor(def.color, -40);
  ctx.fill();

  // Sağ yüz
  ctx.beginPath();
  ctx.moveTo(sx + hw, sy);
  ctx.lineTo(sx + hw, sy - tH);
  ctx.lineTo(sx,      sy + hh - tH);
  ctx.lineTo(sx,      sy + hh);
  ctx.closePath();
  ctx.fillStyle = shadeColor(def.color, -20);
  ctx.fill();

  // Üst yüz
  ctx.beginPath();
  ctx.moveTo(sx,      sy - hh - tH);
  ctx.lineTo(sx + hw, sy - tH);
  ctx.lineTo(sx,      sy + hh - tH);
  ctx.lineTo(sx - hw, sy - tH);
  ctx.closePath();
  ctx.fillStyle = def.color;
  ctx.fill();
  ctx.strokeStyle = ownerColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.globalAlpha = tile.building ? 0.5 + 0.5*progress : 1;
  ctx.font = `${Math.max(10, 18*scale)}px serif`;
  ctx.textAlign = "center";
  ctx.fillText(def.icon, sx, sy - tH - hh/2);

  if (tile.building && progress < 1) {
    ctx.font = `bold ${Math.max(8,10*scale)}px IBM Plex Mono`;
    ctx.fillStyle = "#fff";
    ctx.fillText(`${Math.round(progress*100)}%`, sx, sy - tH + 4);
  }

  ctx.globalAlpha = 1;
}

// ── YOL SEGMENTI ÇİZİMİ ──────────────────────────────────────────────────────
// rot=0 → yol EW (E ve W kenarlarından geçer, NW-SE bağlantı)
// rot=1 → yol NS (N ve S kenarlarından geçer, NE-SW bağlantı)
//
// İzometrik tile köşeleri:
//   N = sx,       sy-hh   (en üst)
//   E = sx+hw,    sy      (sağ)
//   S = sx,       sy+hh   (en alt)
//   W = sx-hw,    sy      (sol)
//
// rot=0 EW yol: yol W→E geçer.
//   Kaldırım: tile'ın N ve S "ince" köşelerinde → tam tile
//   Asfalt: N ve S tarafından inset edilmiş paralel bant
//   Görsel: yol tile'ı sol-sağ kenarlara bağlıdır
//
// rot=1 NS yol: yol N→S geçer.
//   Asfalt: E ve W tarafından inset edilmiş paralel bant

function drawRoadSegment(gx, gy, rot, def, ownerId) {
  ctx.save();
  const { sx, sy } = isoToScreen(gx, gy);
  const hw = TILE_W/2 * scale;
  const hh = TILE_H/2 * scale;
  const r  = (rot ?? 0) % 2;

  // ── YEREL İZOMETRİK KOORDİNAT SİSTEMİ ──
  // lx, ly değerleri 0 ile 1 arasındadır. 
  // (0,0) Kuzey köşesi, (1,1) Güney köşesidir.
  const getIsoPt = (lx, ly) => {
    const dx = lx - 0.5;
    const dy = ly - 0.5;
    return {
      x: sx + (dx - dy) * hw,
      y: sy + (dx + dy) * hh
    };
  };

  // Verilen {lx, ly} noktalarından izometrik poligon çizer
  const drawIsoPoly = (pts, fill) => {
    ctx.beginPath();
    const start = getIsoPt(pts[0].lx, pts[0].ly);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < pts.length; i++) {
      const p = getIsoPt(pts[i].lx, pts[i].ly);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // İki nokta arasına izometrik çizgi çizer
  const drawIsoLine = (lx1, ly1, lx2, ly2, color, width, dash = []) => {
    const p1 = getIsoPt(lx1, ly1);
    const p2 = getIsoPt(lx2, ly2);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.2, width * scale);
    ctx.setLineDash(dash.map(d => d * scale));
    ctx.stroke();
  };

  // ── 1) Kaldırım (Arka Plan Elması) ──
  drawIsoPoly([
    {lx: 0, ly: 0}, {lx: 1, ly: 0}, {lx: 1, ly: 1}, {lx: 0, ly: 1}
  ], "#5c6370");

  // ── 2) Asfalt Zemin ──
  const sw = 0.20; // Kaldırım kalınlığı oranı (Tile'ın %20'si)
  if (r === 0) {
    // EW (Doğu-Batı) Yolu
    drawIsoPoly([
      {lx: 0, ly: sw}, {lx: 1, ly: sw}, {lx: 1, ly: 1-sw}, {lx: 0, ly: 1-sw}
    ], def.color);
  } else {
    // NS (Kuzey-Güney) Yolu
    drawIsoPoly([
      {lx: sw, ly: 0}, {lx: 1-sw, ly: 0}, {lx: 1-sw, ly: 1}, {lx: sw, ly: 1}
    ], def.color);
  }

  // ── 3) Şerit Çizgileri ──
  const mid = 0.5;         // Yolun tam ortası
  const gap = 0.08;        // Çift sarı çizgi arası boşluk
  const dashWhite = [6, 5];// Kesik çizgi deseni
  const q = 0.18;          // Şerit ayırıcı çizgilerin merkeze uzaklığı

  if (r === 0) { // EW Yolu Şeritleri
    if (def.twoWay) {
      // Çift yön sarı merkez çizgileri
      drawIsoLine(0, mid - gap/2, 1, mid - gap/2, "#f5c518", 1.5);
      drawIsoLine(0, mid + gap/2, 1, mid + gap/2, "#f5c518", 1.5);
      if (def.lanes === 2) {
        drawIsoLine(0, mid - q, 1, mid - q, "#fff", 1.5, dashWhite);
        drawIsoLine(0, mid + q, 1, mid + q, "#fff", 1.5, dashWhite);
      }
    } else {
      // Tek yön beyaz kesik merkez çizgi
      drawIsoLine(0, mid, 1, mid, "#fff", 1.5, dashWhite);
      if (def.lanes === 2) {
        drawIsoLine(0, mid - q, 1, mid - q, "#fff", 1.5, dashWhite);
        drawIsoLine(0, mid + q, 1, mid + q, "#fff", 1.5, dashWhite);
      }
    }
  } else { // NS Yolu Şeritleri
    if (def.twoWay) {
      drawIsoLine(mid - gap/2, 0, mid - gap/2, 1, "#f5c518", 1.5);
      drawIsoLine(mid + gap/2, 0, mid + gap/2, 1, "#f5c518", 1.5);
      if (def.lanes === 2) {
        drawIsoLine(mid - q, 0, mid - q, 1, "#fff", 1.5, dashWhite);
        drawIsoLine(mid + q, 0, mid + q, 1, "#fff", 1.5, dashWhite);
      }
    } else {
      drawIsoLine(mid, 0, mid, 1, "#fff", 1.5, dashWhite);
      if (def.lanes === 2) {
        drawIsoLine(mid - q, 0, mid - q, 1, "#fff", 1.5, dashWhite);
        drawIsoLine(mid + q, 0, mid + q, 1, "#fff", 1.5, dashWhite);
      }
    }
  }

  // ── 4) Sahip Çerçevesi ──
  ctx.setLineDash([]);
  if (ownerId && ownerId !== "mainroad") {
    const ownerColor = getPlayerColor(ownerId);
    ctx.strokeStyle = ownerColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    drawIsoLine(0, 0, 1, 0, ownerColor, 1.5);
    drawIsoLine(1, 0, 1, 1, ownerColor, 1.5);
    drawIsoLine(1, 1, 0, 1, ownerColor, 1.5);
    drawIsoLine(0, 1, 0, 0, ownerColor, 1.5);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}
// Şerit çizgilerini çizer
// isHorizontal=true → xStart→xEnd, ortaY sabit
// isHorizontal=false → yStart→yEnd, ortaX sabit
function drawLaneMarkings(start, end, mid, def, isHorizontal) {
  const S = scale;

  if (def.twoWay) {
    // Çift sarı merkez çizgi
    const g = Math.max(1.2, S * 1.3);
    ctx.strokeStyle = "#f5c518";
    ctx.globalAlpha = 0.95;
    ctx.setLineDash([]);
    if (isHorizontal) {
      ctx.beginPath(); ctx.moveTo(start, mid-g); ctx.lineTo(end, mid-g); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(start, mid+g); ctx.lineTo(end, mid+g); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(mid-g, start); ctx.lineTo(mid-g, end); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mid+g, start); ctx.lineTo(mid+g, end); ctx.stroke();
    }

    if (def.lanes === 2) {
      // Her yön için beyaz kesik şerit
      const q = Math.max(2.5, S * 3);
      ctx.strokeStyle = "#fff";
      ctx.globalAlpha = 0.4;
      ctx.setLineDash([6*S, 5*S]);
      if (isHorizontal) {
        ctx.beginPath(); ctx.moveTo(start, mid-g-q); ctx.lineTo(end, mid-g-q); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(start, mid+g+q); ctx.lineTo(end, mid+g+q); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(mid-g-q, start); ctx.lineTo(mid-g-q, end); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mid+g+q, start); ctx.lineTo(mid+g+q, end); ctx.stroke();
      }
    }
  } else {
    // Tek yön — beyaz kesik merkez çizgi
    ctx.strokeStyle = "#fff";
    ctx.globalAlpha = 0.65;
    ctx.setLineDash([6*S, 5*S]);
    if (isHorizontal) {
      ctx.beginPath(); ctx.moveTo(start, mid); ctx.lineTo(end, mid); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(mid, start); ctx.lineTo(mid, end); ctx.stroke();
    }

    if (def.lanes === 2) {
      const q = Math.max(2.5, S * 3);
      if (isHorizontal) {
        ctx.beginPath(); ctx.moveTo(start, mid-q); ctx.lineTo(end, mid-q); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(start, mid+q); ctx.lineTo(end, mid+q); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(mid-q, start); ctx.lineTo(mid-q, end); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mid+q, start); ctx.lineTo(mid+q, end); ctx.stroke();
      }
    }
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// ── HOVER ─────────────────────────────────────────────────────────────────────
function drawHover(gs) {
  if (!hoverCell) return;
  const { x, y } = hoverCell;
  if (x < 0 || y < 0 || x >= gs || y >= gs) return;

  const { sx, sy } = isoToScreen(x, y);
  const isValid = canPlaceHere(x, y);

  const placingRoad = selectedTool === "build" && selectedTile && TILES[selectedTile]?.isRoad;

  if (placingRoad && isValid) {
    // Sağ tık rotasyonunu kusursuz görmek için gerçek yol fonksiyonunu yarı saydam çağırıyoruz
    ctx.globalAlpha = 0.6;
    drawRoadSegment(x, y, roadRotation, TILES[selectedTile], null);
    ctx.globalAlpha = 1;
  } else {
    // Yol dışındaki binalar veya geçersiz alanlar için elmas şekli
    const col = selectedTool === "demolish" ? "#ff4444"
              : isValid ? "#58a6ff" : "#ff4444";
    drawDiamond(sx, sy, col+"30", col, 1);
  }
}

// ── EDGE BUTTONS ──────────────────────────────────────────────────────────────
function drawEdgeButtons(gs) {
  const dirs = [
    { dir:"north", gx:gs/2,     gy:-1.5    },
    { dir:"south", gx:gs/2,     gy:gs+0.5  },
    { dir:"west",  gx:-1.5,     gy:gs/2    },
    { dir:"east",  gx:gs+0.5,   gy:gs/2    },
  ];
  ctx.save();
  ctx.font = "bold 13px IBM Plex Mono";
  ctx.textAlign = "center";
  const canExpand = (gameState?.fund?.expansionFund ?? 0) >= EXPAND_COST;
  for (const { dir, gx, gy } of dirs) {
    const { sx, sy } = isoToScreen(gx, gy);
    ctx.beginPath();
    ctx.arc(sx, sy, 18, 0, Math.PI*2);
    ctx.fillStyle   = canExpand ? "#1f6feb" : "#21262d";
    ctx.strokeStyle = canExpand ? "#58a6ff" : "#30363d";
    ctx.lineWidth   = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = canExpand ? "#fff" : "#484f58";
    ctx.fillText("+", sx, sy+5);
  }
  ctx.restore();
}

// ── ARABA SİSTEMİ ─────────────────────────────────────────────────────────────
// Araçlar yol tile'larının "path"ında hareket eder.
// Her yol tile'ı için 1-2 araba spawn edilebilir.
// Araçlar tile merkezinden diğer tile merkezine progress 0→1 ile hareket eder.

function getRoadTiles() {
  // Hem gameState.tiles içindeki yollar hem de anayol satırı
  const gs   = gameState?.gridSize || 20;
  const row  = gameState?.mainRoadRow ?? Math.floor(gs / 2);
  const roads = new Map(); // "gx,gy" → { rot, def, isMainRoad }

  // Anayol
  const ext = 6;
  for (let x = -ext; x < gs + ext; x++) {
    roads.set(`${x},${row}`, { rot:0, def:{ lanes:2, twoWay:true }, isMainRoad:true });
  }

  // Oyuncu yolları
  if (gameState?.tiles) {
    for (const [key, tile] of Object.entries(gameState.tiles)) {
      if (TILES[tile.type]?.isRoad) {
        roads.set(key, { rot: tile.rotation ?? 0, def: TILES[tile.type], isMainRoad:false });
      }
    }
  }
  return roads;
}

function syncCarsToRoads() {
  const roads = getRoadTiles();
  const targetCount = Math.min(60, roads.size * 1.5 | 0);

  // Fazla araçları sil
  while (cars.length > targetCount + 5) cars.pop();

  // Yetersizse ekle
  if (cars.length < targetCount) {
    const keys = [...roads.keys()];
    const tries = 20;
    for (let i = 0; i < tries && cars.length < targetCount; i++) {
      const key = keys[Math.floor(Math.random() * keys.length)];
      const road = roads.get(key);
      if (!road) continue;
      const [gx, gy] = key.split(",").map(Number);
      spawnCar(gx, gy, road.rot, road.def);
    }
  }
}

function spawnCar(gx, gy, rot, def) {
  const lanes = def.lanes || 1;
  const twoWay = def.twoWay;
  // lane: -1 veya +1 (çift yönde) veya 0 (tek yön)
  const lane = twoWay ? (Math.random() < 0.5 ? -1 : 1) : 1;
  const dir  = lane;  // hareket yönü: +1 veya -1

  cars.push({
    id:       _carIdCounter++,
    gx, gy,
    rot:      rot % 2,
    progress: Math.random(), // tile içinde rastgele başlat
    speed:    CAR_SPEED * (0.7 + Math.random() * 0.8),
    lane,
    dir,
    color:    CAR_COLORS[Math.floor(Math.random()*CAR_COLORS.length)],
    lanes,
    twoWay,
  });
}

function updateCars() {
  if (!gameState) return;
  const roads = getRoadTiles();
  const gs    = gameState.gridSize || 20;
  const row   = gameState?.mainRoadRow ?? Math.floor(gs / 2);

  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];
    car.progress += car.speed;

    if (car.progress >= 1) {
      car.progress -= 1;
      // Bir sonraki tile'a geç
      let ngx = car.gx, ngy = car.gy;
      if (car.rot === 0) {
        ngx += car.dir; // EW hareketi
      } else {
        ngy += car.dir; // NS hareketi
      }

      const nextKey = `${ngx},${ngy}`;
      const nextRoad = roads.get(nextKey);

      if (nextRoad) {
        // Yol devam ediyor, aynı yönde git veya dön
        const nextRot = nextRoad.rot % 2;
        if (nextRot !== car.rot) {
          // Köşe: rotasyonu değiştir, yönü ayarla
          car.rot = nextRot;
          // Yeni yönde rastgele ileri/geri
          car.dir = car.dir;
        }
        car.gx = ngx;
        car.gy = ngy;
        car.rot = nextRot;
      } else {
        // Yol bitti — geri dön
        car.dir *= -1;
        // Anayolda sonsuza git (grid dışı da geçerli)
        if (car.gy === row) {
          car.gx = ngx; // anayolda devam et
        }
        // Anayolda ext sınırının dışına çıktıysa sıfırla
        const ext = 6;
        if (car.gx < -ext || car.gx >= gs + ext) {
          car.gx = car.dir > 0 ? -ext : gs + ext - 1;
        }
      }
    }
  }
}

function drawCars() {
  if (!gameState) return;
  const gs  = gameState.gridSize || 20;
  const row = gameState?.mainRoadRow ?? Math.floor(gs / 2);

  for (const car of cars) {
    drawCar(car, gs, row);
  }
}

function drawCar(car, gs, row) {
  // Arabanın canvas pozisyonunu hesapla
  const { gx, gy, rot, progress, dir, lane, color } = car;

  // Tile'daki konum: progress=0 → giriş kenarı, progress=1 → çıkış kenarı
  // rot=0 EW: gx + progress*dir
  // rot=1 NS: gy + progress*dir

  let wx = gx, wy = gy; // gerçek dünya koordinatı (float)
  if (rot === 0) {
    wx = gx + (progress - 0.5) * dir;
    wy = gy;
  } else {
    wx = gx;
    wy = gy + (progress - 0.5) * dir;
  }

  // Şerit ofseti — arabayı yolun ortasından yana kaydır
  const laneOffset = lane * 0.18; // tile birimi cinsinden
  if (rot === 0) {
    wy += laneOffset;
  } else {
    wx += laneOffset;
  }

  const { sx, sy } = isoToScreen(wx, wy);

  // Araba boyutu (scale ile)
  const W = Math.max(6, 12 * scale);
  const H = Math.max(3, 6  * scale);

  ctx.save();

  // İzometrik rotation — rot=0 yatay, rot=1 dikey
  const angle = rot === 0 ? Math.atan2(TILE_H/2, TILE_W/2) : Math.atan2(TILE_H/2, -TILE_W/2);
  const finalAngle = dir > 0 ? angle : angle + Math.PI;

  ctx.translate(sx, sy);
  ctx.rotate(finalAngle);

  // Gövde
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-W/2, -H/2, W, H, H*0.3);
  ctx.fill();

  // Cam (ön)
  ctx.fillStyle = "rgba(180,220,255,0.7)";
  ctx.beginPath();
  ctx.roundRect(W*0.1, -H*0.35, W*0.3, H*0.7, H*0.15);
  ctx.fill();

  // Farlar
  ctx.fillStyle = "#fffbe0";
  ctx.beginPath();
  ctx.arc(W/2 - 1, -H*0.25, Math.max(1, H*0.15), 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W/2 - 1,  H*0.25, Math.max(1, H*0.15), 0, Math.PI*2);
  ctx.fill();

  // Stop lambaları
  ctx.fillStyle = "#ff4444";
  ctx.beginPath();
  ctx.arc(-W/2 + 1, -H*0.25, Math.max(1, H*0.12), 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-W/2 + 1,  H*0.25, Math.max(1, H*0.12), 0, Math.PI*2);
  ctx.fill();

  ctx.restore();
}

// ── EVENTS ────────────────────────────────────────────────────────────────────
function bindEvents() {
  canvas.addEventListener("mousedown",   onMouseDown);
  canvas.addEventListener("mousemove",   onMouseMove);
  canvas.addEventListener("mouseup",     onMouseUp);
  canvas.addEventListener("mouseleave",  onMouseUp);
  canvas.addEventListener("click",       onClick);
  canvas.addEventListener("contextmenu", onRightClick);
  canvas.addEventListener("wheel",       onWheel, { passive: false });
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
  if (dragging) {
    camX = camStart.x + (e.clientX - dragStart.x);
    camY = camStart.y + (e.clientY - dragStart.y);
  }
  const { gx, gy } = screenToIso(e.clientX - rect.left, e.clientY - rect.top);
  hoverCell = { x: gx, y: gy };
}

function onMouseUp() { if (dragging) { dragging = false; canvas.style.cursor = "default"; } }

function onRightClick(e) {
  e.preventDefault();
  if (selectedTile && TILES[selectedTile]?.isRoad) {
    roadRotation = (roadRotation + 1) % 2;
    updateRotateBtn();
  }
}

let _lastClick = 0;
async function onClick(e) {
  const now = Date.now();
  if (now - _lastClick < 200) return;
  _lastClick = now;
  if (dragging) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (checkEdgeButtonClick(mx, my)) return;

  const { gx, gy } = screenToIso(mx, my);
  const gs = gameState?.gridSize || 20;
  if (gx < 0 || gy < 0 || gx >= gs || gy >= gs) return;

  if      (selectedTool === "build"   && selectedTile) await handleBuildClick(gx, gy);
  else if (selectedTool === "demolish")                await handleDemolishClick(gx, gy);
  else if (selectedTool === "fund")                    await handleFundClick(gx, gy);
  else                                                 handleInfoClick(gx, gy);
}

function checkEdgeButtonClick(mx, my) {
  if (!gameState) return false;
  const gs = gameState.gridSize || 20;
  const dirs = [
    { dir:"north", gx:gs/2,   gy:-1.5   },
    { dir:"south", gx:gs/2,   gy:gs+0.5 },
    { dir:"west",  gx:-1.5,   gy:gs/2   },
    { dir:"east",  gx:gs+0.5, gy:gs/2   },
  ];
  for (const { dir, gx, gy } of dirs) {
    const { sx, sy } = isoToScreen(gx, gy);
    if (Math.hypot(mx-sx, my-sy) < 18) { openExpansionModal(dir); return true; }
  }
  return false;
}

function onWheel(e) {
  e.preventDefault();
  const factor   = e.deltaY < 0 ? 1.1 : 0.9;
  const rect     = canvas.getBoundingClientRect();
  const pivotX   = e.clientX - rect.left;
  const pivotY   = e.clientY - rect.top;
  const newScale = Math.max(0.3, Math.min(2.5, scale * factor));
  const ratio    = newScale / scale;
  camX  = pivotX - (pivotX - camX) * ratio;
  camY  = pivotY - (pivotY - camY) * ratio;
  scale = newScale;
}

let _touches = [], _pinchDist = 0;
function onTouchStart(e) {
  _touches = [...e.touches];
  if (e.touches.length === 1) {
    dragging  = true;
    dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    camStart  = { x: camX, y: camY };
  } else if (e.touches.length === 2) {
    dragging   = false;
    _pinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}
function onTouchMove(e) {
  if (e.touches.length === 1 && dragging) {
    e.preventDefault();
    camX = camStart.x + (e.touches[0].clientX - dragStart.x);
    camY = camStart.y + (e.touches[0].clientY - dragStart.y);
  } else if (e.touches.length === 2) {
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (_pinchDist > 0) {
      const rect  = canvas.getBoundingClientRect();
      const midX  = (e.touches[0].clientX + e.touches[1].clientX)/2 - rect.left;
      const midY  = (e.touches[0].clientY + e.touches[1].clientY)/2 - rect.top;
      const newScale = Math.max(0.3, Math.min(2.5, scale * dist / _pinchDist));
      const ratio    = newScale / scale;
      camX  = midX - (midX - camX) * ratio;
      camY  = midY - (midY - camY) * ratio;
      scale = newScale;
    }
    _pinchDist = dist;
  }
}
function onTouchEnd() { dragging = false; _pinchDist = 0; }

// ── AKSİYONLAR ────────────────────────────────────────────────────────────────
async function handleBuildClick(gx, gy) {
  const def = TILES[selectedTile];
  if (!def) return;

  const existing = gameState?.tiles?.[`${gx},${gy}`];
  if (existing && TILES[existing.type]?.isRoad && !def.isRoad) {
    showToast("Yol üzerine bina inşa edilemez", "error"); return;
  }
  if (def.unique) {
    const already = Object.values(gameState.tiles || {}).find(t => t.type === selectedTile);
    if (already) { showToast("Bu binanın sadece bir tanesi olabilir", "error"); return; }
  }
  // game.js içindeki handleBuildClick fonksiyonunun ilgili kısmı
try {
  const rot = def.isRoad ? roadRotation : 0;
  // placeTile artık 5. parametre olarak rot değerini veritabanına ulaştıracak
  const key = await placeTile(roomId, gx, gy, selectedTile, def.cost, rot);
  
  if (def.isRoad) {
    showToast(`${def.label} yapıldı`, "success");
    syncCarsToRoads();
  } else {
    startBuildAnimation(key);
    showToast(`${def.label} inşaatı başladı!`, "success");
  }
} catch (err) { showToast(err.message, "error"); }
}

async function handleDemolishClick(gx, gy) {
  const key  = `${gx},${gy}`;
  const tile = gameState?.tiles?.[key];
  if (!tile) { showToast("Boş alan", "info"); return; }
  if (tile.ownerId === myUser.uid) {
    if (!confirm(`"${TILES[tile.type]?.label || tile.type}" yıkılsın mı?`)) return;
    try { await demolishOwn(roomId, gx, gy); showToast("Yıkıldı", "success"); }
    catch(e) { showToast(e.message, "error"); }
  } else {
    if (!confirm(`${tile.ownerName}'in binası için yıkım izni iste?`)) return;
    try { await requestDemolish(roomId, gx, gy); showToast(`${tile.ownerName}'e istek gönderildi`, "info"); }
    catch(e) { showToast(e.message, "error"); }
  }
}

async function handleFundClick(gx, gy) {
  const tile = gameState?.tiles?.[`${gx},${gy}`];
  if (tile?.type === "fund") openFundModal();
  else showToast("Fon binasına tıkla", "info");
}

function handleInfoClick(gx, gy) {
  const tile = gameState?.tiles?.[`${gx},${gy}`];
  if (!tile) return;
  const def = TILES[tile.type];
  showToast(`${def?.icon||""} ${def?.label||tile.type} — ${tile.ownerName}`, "info");
}

// ── İNŞAAT ANİMASYONU ─────────────────────────────────────────────────────────
function startBuildAnimation(key) {
  buildQueue[key] = { progress:0, startTime:Date.now(), duration:2000 };
}

function handleGameStateChange(prev, next) {
  if (!next?.tiles) return;
  Object.entries(next.tiles).forEach(([key, tile]) => {
    if (tile.building && !buildQueue[key])
      buildQueue[key] = { progress:0, startTime:Date.now(), duration:2000 };
  });
  checkDemolishRequests(next);
  checkExpansionVote(next);
  updateHUD(next);
}

function updateBuildQueues() {
  const now = Date.now();
  for (const [key, q] of Object.entries(buildQueue)) {
    q.progress = Math.min(1, (now - q.startTime) / q.duration);
    if (q.progress >= 1) {
      delete buildQueue[key];
      finishBuilding(roomId, key).catch(()=>{});
    }
  }
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
  card.style.cssText = `pointer-events:auto;position:absolute;top:1rem;right:1rem;
    background:#161b22;border:1px solid #f85149;border-radius:8px;padding:1rem 1.25rem;
    max-width:280px;font-size:13px;z-index:10;animation:slideIn 0.3s ease;`;
  const tileName = TILES[req.tileType]?.label || req.tileType;
  card.innerHTML = `
    <div style="font-weight:600;color:#f85149;margin-bottom:6px">⚠ Yıkım İsteği</div>
    <div style="color:#e6edf3;margin-bottom:10px"><b>${req.requesterName}</b>, senin <b>${tileName}</b> binasını yıkmak istiyor.</div>
    <div style="display:flex;gap:8px;">
      <button id="demolish-accept-${reqId}" style="flex:1;background:#490202;color:#f85149;border:1px solid #f85149;border-radius:6px;padding:6px;cursor:pointer;font-size:12px;">✓ İzin Ver</button>
      <button id="demolish-reject-${reqId}" style="flex:1;background:#21262d;color:#8b949e;border:1px solid #30363d;border-radius:6px;padding:6px;cursor:pointer;font-size:12px;">✗ Reddet</button>
    </div>`;
  overlay.appendChild(card);
  document.getElementById(`demolish-accept-${reqId}`).onclick = async () => {
    await respondDemolish(roomId, reqId, true); card.remove(); showToast("Yıkım izni verildi","success");
  };
  document.getElementById(`demolish-reject-${reqId}`).onclick = async () => {
    await respondDemolish(roomId, reqId, false); card.remove(); showToast("Yıkım reddedildi","info");
  };
  setTimeout(()=>{ if(document.getElementById(`demolish-req-${reqId}`)) card.remove(); }, 30000);
}

// ── EXPANSION VOTE ────────────────────────────────────────────────────────────
function checkExpansionVote(gs) {
  if (!gs.pendingExpansion) {
    const old = document.getElementById("expansion-vote-card");
    if (old) old.remove();
    return;
  }
  const pending = gs.pendingExpansion;
  if (pending.votes?.[myUser.uid] !== undefined) return;
  if (document.getElementById("expansion-vote-card")) return;
  showExpansionVoteCard(pending);
}
function showExpansionVoteCard(pending) {
  const overlay = document.getElementById("game-ui-overlay");
  const dirLabels = { north:"Kuzey", south:"Güney", west:"Batı", east:"Doğu" };
  const card = document.createElement("div");
  card.id = "expansion-vote-card";
  card.style.cssText = `pointer-events:auto;position:absolute;top:1rem;left:50%;transform:translateX(-50%);
    background:#161b22;border:1px solid #1f6feb;border-radius:8px;
    padding:1rem 1.25rem;max-width:300px;font-size:13px;z-index:10;text-align:center;`;
  card.innerHTML = `
    <div style="font-weight:600;color:#58a6ff;margin-bottom:6px">🏙 Şehir Genişletme</div>
    <div style="color:#e6edf3;margin-bottom:10px">
      <b>${pending.requestedByName}</b>, şehri <b>${dirLabels[pending.direction]||pending.direction}</b> yönüne genişletmek istiyor.<br>
      <span style="color:#8b949e;font-size:12px;">Maliyet: ${pending.cost.toLocaleString()}₺</span>
    </div>
    <div style="display:flex;gap:8px;">
      <button id="exp-yes" style="flex:1;background:#0d419d;color:#58a6ff;border:1px solid #1f6feb;border-radius:6px;padding:6px;cursor:pointer;">✓ Onayla</button>
      <button id="exp-no"  style="flex:1;background:#21262d;color:#8b949e;border:1px solid #30363d;border-radius:6px;padding:6px;cursor:pointer;">✗ Reddet</button>
    </div>`;
  overlay.appendChild(card);
  document.getElementById("exp-yes").onclick = async () => {
    await voteExpansion(roomId, true); card.remove(); showToast("Genişletmeye oy verdin!","success");
  };
  document.getElementById("exp-no").onclick = async () => {
    await voteExpansion(roomId, false); card.remove(); showToast("Genişletmeyi reddettin","info");
  };
}

// ── MODALLER ──────────────────────────────────────────────────────────────────
function openFundModal() {
  const players  = roomData?.players || {};
  const budgets  = gameState?.budgets || {};
  const fund     = gameState?.fund || {};
  const myBudget = budgets[myUser.uid] || 0;
  const playerOptions = Object.entries(players)
    .filter(([uid]) => uid !== myUser.uid)
    .map(([uid,p]) => `<option value="${uid}">${p.name} (${(budgets[uid]||0).toLocaleString()}₺)</option>`)
    .join("");
  showModal("🏦 Fon Binası", `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:#21262d;border-radius:6px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:#8b949e;margin-bottom:4px;">Genel Fon</div>
        <div style="font-size:20px;font-weight:600;color:#58a6ff;">${(fund.balance||0).toLocaleString()}₺</div>
      </div>
      <div style="background:#21262d;border-radius:6px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:#8b949e;margin-bottom:4px;">Expansion Fonu</div>
        <div style="font-size:20px;font-weight:600;color:#3fb950;">${(fund.expansionFund||0).toLocaleString()}₺</div>
      </div>
    </div>
    <div style="font-size:11px;color:#8b949e;margin-bottom:8px;">Benim bütçem: <b style="color:#e6edf3;">${myBudget.toLocaleString()}₺</b></div>
    <div style="border-top:1px solid #30363d;padding-top:12px;margin-top:4px;">
      <div style="font-weight:600;margin-bottom:8px;font-size:13px;">💸 Genel Fona Para Yatır</div>
      <div style="display:flex;gap:8px;margin-bottom:4px;">
        <input id="fund-deposit-amt" type="number" min="100" max="${myBudget}" value="1000"
          style="flex:1;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#e6edf3;padding:6px 10px;font-size:13px;" />
        <button id="fund-deposit-btn" class="btn btn-primary" style="white-space:nowrap;">Yatır</button>
      </div>
    </div>
    <div style="border-top:1px solid #30363d;padding-top:12px;margin-top:8px;">
      <div style="font-weight:600;margin-bottom:8px;font-size:13px;">🤝 Oyuncuya Transfer</div>
      <select id="fund-target-player" style="width:100%;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#e6edf3;padding:6px 10px;font-size:13px;margin-bottom:6px;">
        ${playerOptions||'<option disabled>Başka oyuncu yok</option>'}
      </select>
      <div style="display:flex;gap:8px;">
        <input id="fund-transfer-amt" type="number" min="100" max="${myBudget}" value="1000"
          style="flex:1;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#e6edf3;padding:6px 10px;font-size:13px;" />
        <button id="fund-transfer-btn" class="btn btn-primary" style="white-space:nowrap;">Gönder</button>
      </div>
    </div>
    <div style="border-top:1px solid #30363d;padding-top:12px;margin-top:8px;">
      <div style="font-weight:600;margin-bottom:8px;font-size:13px;">🌆 Expansion Fonuna Ekle</div>
      <div style="font-size:11px;color:#8b949e;margin-bottom:6px;">Hedef: ${EXPAND_COST.toLocaleString()}₺</div>
      <div style="display:flex;gap:8px;">
        <input id="fund-expand-amt" type="number" min="100" max="${myBudget}" value="5000"
          style="flex:1;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#e6edf3;padding:6px 10px;font-size:13px;" />
        <button id="fund-expand-btn" class="btn btn-success" style="white-space:nowrap;">Ekle</button>
      </div>
    </div>
  `, async()=>{});
  document.getElementById("fund-deposit-btn").onclick = async () => {
    const amt = parseInt(document.getElementById("fund-deposit-amt").value);
    try { await transferToFund(roomId,amt); showToast(`${amt.toLocaleString()}₺ fona yatırıldı`,"success"); closeModal(); }
    catch(e) { showToast(e.message,"error"); }
  };
  document.getElementById("fund-transfer-btn").onclick = async () => {
    const toUid = document.getElementById("fund-target-player").value;
    const amt   = parseInt(document.getElementById("fund-transfer-amt").value);
    if (!toUid) return;
    try { await transferBetweenPlayers(roomId,toUid,amt); showToast(`${amt.toLocaleString()}₺ transfer edildi`,"success"); closeModal(); }
    catch(e) { showToast(e.message,"error"); }
  };
  document.getElementById("fund-expand-btn").onclick = async () => {
    const amt = parseInt(document.getElementById("fund-expand-amt").value);
    try { await addToExpansionFund(roomId,amt); showToast(`${amt.toLocaleString()}₺ expansion fonuna eklendi`,"success"); closeModal(); }
    catch(e) { showToast(e.message,"error"); }
  };
}

function openExpansionModal(direction) {
  const fund    = gameState?.fund || {};
  const expFund = fund.expansionFund || 0;
  const canExpand = expFund >= EXPAND_COST;
  const dirLabels = { north:"Kuzey", south:"Güney", west:"Batı", east:"Doğu" };
  showModal("🌆 Şehir Genişlet", `
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:2rem;margin-bottom:8px;">${direction==="north"?"⬆️":direction==="south"?"⬇️":direction==="west"?"⬅️":"➡️"}</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:4px;">${dirLabels[direction]} yönüne genişlet</div>
      <div style="color:#8b949e;font-size:13px;">Grid: +4 satır/sütun</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      <div style="background:#21262d;border-radius:6px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:#8b949e;">Mevcut Fon</div>
        <div style="font-size:18px;font-weight:600;color:${canExpand?"#3fb950":"#f85149"};">${expFund.toLocaleString()}₺</div>
      </div>
      <div style="background:#21262d;border-radius:6px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:#8b949e;">Gereken</div>
        <div style="font-size:18px;font-weight:600;color:#58a6ff;">${EXPAND_COST.toLocaleString()}₺</div>
      </div>
    </div>
    ${!canExpand
      ? `<div style="background:#490202;border:1px solid #f85149;border-radius:6px;padding:10px;color:#f85149;font-size:12px;margin-bottom:12px;text-align:center;">
           Fon yetersiz. ${(EXPAND_COST-expFund).toLocaleString()}₺ daha gerekli.
         </div>`
      : `<div style="background:#0d2a0d;border:1px solid #3fb950;border-radius:6px;padding:10px;color:#3fb950;font-size:12px;margin-bottom:12px;text-align:center;">
           Fon yeterli! Tüm oyuncuların oyu alınacak.
         </div>`}
    <button id="expand-confirm" class="btn btn-primary btn-full" ${canExpand?"":"disabled"}>Genişletme İsteği Gönder</button>
  `, ()=>{});
  if (canExpand) {
    document.getElementById("expand-confirm").onclick = async () => {
      try { await requestExpansion(roomId, direction); showToast("Genişletme oyu başlatıldı!","success"); closeModal(); }
      catch(e) { showToast(e.message,"error"); }
    };
  }
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function updateHUD(gs) {
  const myBudget = gs.budgets?.[myUser.uid] ?? 0;
  const el = document.getElementById("hud-budget");
  if (el) el.textContent = myBudget.toLocaleString() + "₺";
  const pop = document.getElementById("hud-pop");
  if (pop) pop.textContent = (Object.keys(gs.tiles||{}).length * 15).toLocaleString();
  const fund = document.getElementById("hud-fund");
  if (fund) fund.textContent = (gs.fund?.balance ?? 0).toLocaleString() + "₺";
  const expFund = document.getElementById("hud-expfund");
  if (expFund) expFund.textContent = (gs.fund?.expansionFund ?? 0).toLocaleString() + "₺";
}

// ── UI ────────────────────────────────────────────────────────────────────────
function buildUI() { buildToolbar(); buildHUD(); }

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
    { id:"mode-build",    label:"🔨 İnşa",   tool:"build"    },
    { id:"mode-demolish", label:"💥 Yık",    tool:"demolish" },
    { id:"mode-fund",     label:"🏦 Fon",    tool:"fund"     },
    { id:"mode-pan",      label:"✋ Pan",    tool:null       },
  ];
  const modeBar = document.createElement("div");
  modeBar.style.cssText = "display:flex;gap:6px;align-items:center;flex-shrink:0;";
  modes.forEach(m => {
    const btn = document.createElement("button");
    btn.id = m.id;
    btn.className = "btn btn-ghost";
    btn.style.cssText = "padding:5px 10px;font-size:12px;";
    btn.textContent = m.label;
    btn.onclick = () => {
      selectedTool = m.tool;
      selectedTile = null;
      document.querySelectorAll("[id^='mode-']").forEach(b => b.classList.remove("active-tool"));
      btn.classList.add("active-tool");
      updateTilePanel();
      updateRotateBtn();
    };
    modeBar.appendChild(btn);
  });
  toolbar.appendChild(modeBar);

  const sep = document.createElement("div");
  sep.style.cssText = "width:1px;background:#30363d;align-self:stretch;margin:0 4px;";
  toolbar.appendChild(sep);

  // Zoom butonları
  const zoomBar = document.createElement("div");
  zoomBar.style.cssText = "display:flex;gap:4px;align-items:center;flex-shrink:0;";
  const btnZI = document.createElement("button");
  btnZI.className = "btn btn-ghost";
  btnZI.style.cssText = "padding:4px 9px;font-size:14px;line-height:1;";
  btnZI.title = "Yakınlaştır";
  btnZI.textContent = "+";
  btnZI.onclick = () => {
    const ns = Math.min(2.5, scale*1.2);
    const r  = ns/scale;
    camX = canvas.width/2  - (canvas.width/2  - camX)*r;
    camY = canvas.height/2 - (canvas.height/2 - camY)*r;
    scale = ns;
  };
  const btnZO = document.createElement("button");
  btnZO.className = "btn btn-ghost";
  btnZO.style.cssText = "padding:4px 9px;font-size:14px;line-height:1;";
  btnZO.title = "Uzaklaştır";
  btnZO.textContent = "−";
  btnZO.onclick = () => {
    const ns = Math.max(0.3, scale*0.83);
    const r  = ns/scale;
    camX = canvas.width/2  - (canvas.width/2  - camX)*r;
    camY = canvas.height/2 - (canvas.height/2 - camY)*r;
    scale = ns;
  };
  const btnZR = document.createElement("button");
  btnZR.className = "btn btn-ghost";
  btnZR.style.cssText = "padding:4px 8px;font-size:10px;";
  btnZR.title = "Sıfırla";
  btnZR.textContent = "⌂";
  btnZR.onclick = () => { scale = 1; centerCamera(); };
  zoomBar.appendChild(btnZI); zoomBar.appendChild(btnZO); zoomBar.appendChild(btnZR);
  toolbar.appendChild(zoomBar);

  const sep2 = document.createElement("div");
  sep2.style.cssText = "width:1px;background:#30363d;align-self:stretch;margin:0 4px;";
  toolbar.appendChild(sep2);

  // Mobil rotate butonu
  const rotBtn = document.createElement("button");
  rotBtn.id = "btn-road-rotate";
  rotBtn.className = "btn btn-ghost";
  rotBtn.style.cssText = "display:none;padding:5px 10px;font-size:12px;";
  rotBtn.title = "Yol yönünü çevir (Sağ tık)";
  rotBtn.onclick = () => {
    roadRotation = (roadRotation + 1) % 2;
    updateRotateBtn();
  };
  toolbar.appendChild(rotBtn);
  updateRotateBtn();

  const sep3 = document.createElement("div");
  sep3.id = "sep-rotate";
  sep3.style.cssText = "display:none;width:1px;background:#30363d;align-self:stretch;margin:0 4px;";
  toolbar.appendChild(sep3);

  // Tile paneli
  const tilePanel = document.createElement("div");
  tilePanel.id = "tile-panel";
  tilePanel.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;align-items:center;flex:1;overflow-x:auto;";
  toolbar.appendChild(tilePanel);

  // Stiller
  const style = document.createElement("style");
  style.textContent = `
    .active-tool { background:#1f6feb !important; color:#fff !important; border-color:#58a6ff !important; }
    .tile-btn { background:#21262d; border:1px solid #30363d; border-radius:6px; color:#e6edf3;
                padding:4px 8px; font-size:11px; cursor:pointer; transition:all 0.1s; white-space:nowrap; }
    .tile-btn:hover { border-color:#58a6ff; background:#1c2333; }
    .tile-btn.selected { background:#1f6feb; border-color:#58a6ff; color:#fff; }
    .tile-cat { font-size:10px; color:#8b949e; padding:0 4px; font-weight:600; text-transform:uppercase; }
    @keyframes slideIn { from { transform:translateX(20px); opacity:0; } to { transform:translateX(0); opacity:1; } }
  `;
  document.head.appendChild(style);

  updateTilePanel();
}

function updateRotateBtn() {
  const btn  = document.getElementById("btn-road-rotate");
  const sep  = document.getElementById("sep-rotate");
  const show = selectedTool === "build" && selectedTile && TILES[selectedTile]?.isRoad;
  if (!btn) return;
  btn.style.display = show ? "inline-flex" : "none";
  if (sep) sep.style.display = show ? "block" : "none";
  const labels = ["↔ EW (Yatay)", "↕ NS (Dikey)"];
  btn.textContent = "🔄 " + (labels[roadRotation] || "EW");
}

function lanesSvg(lanes, twoWay) {
  const lc   = twoWay ? "#f5c518" : "#fff";
  const dash = twoWay ? "0" : "4,3";
  const lines = lanes === 1
    ? `<line x1="3" y1="10" x2="33" y2="10" stroke="${lc}" stroke-width="1.5" stroke-dasharray="${dash}"/>`
    : `<line x1="3" y1="7" x2="33" y2="7" stroke="${lc}" stroke-width="1.2" stroke-dasharray="${dash}"/>
       <line x1="3" y1="13" x2="33" y2="13" stroke="${lc}" stroke-width="1.2" stroke-dasharray="${dash}"/>`;
  const arrow = !twoWay ? `<polygon points="27,10 22,7.5 22,12.5" fill="#ffffff88"/>` : "";
  return `<svg width="36" height="20" viewBox="0 0 36 20"
    style="margin-right:4px;flex-shrink:0;vertical-align:middle;border-radius:3px;">
    <rect width="36" height="20" fill="#3e4349"/>
    <rect x="2" y="1" width="32" height="18" fill="#4a4f57"/>
    <rect x="2" y="1" width="2.5" height="18" fill="#6b7180"/>
    <rect x="31.5" y="1" width="2.5" height="18" fill="#6b7180"/>
    ${lines}${arrow}
  </svg>`;
}

function updateTilePanel() {
  const panel = document.getElementById("tile-panel");
  if (!panel) return;
  panel.innerHTML = "";

  if (selectedTool !== "build") {
    const hint = document.createElement("span");
    hint.style.cssText = "font-size:12px;color:#484f58;padding:0 8px;";
    hint.textContent = selectedTool==="demolish" ? "Yıkmak istediğin tile'a tıkla"
                     : selectedTool==="fund"     ? "Fon binasına tıkla"
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

      if (def.isRoad) {
        btn.innerHTML = `${lanesSvg(def.lanes, def.twoWay)}
          <span style="display:flex;flex-direction:column;gap:1px;min-width:0;">
            <span style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${def.label}</span>
            <span style="color:#58a6ff;font-size:10px;">${def.cost.toLocaleString()}₺</span>
          </span>`;
        btn.style.cssText += "display:flex;align-items:center;gap:4px;padding:4px 6px;";
      } else {
        btn.innerHTML = `${def.icon} ${def.label} <span style="color:#58a6ff">${def.cost.toLocaleString()}₺</span>`;
      }

      btn.onclick = () => {
        selectedTile = type;
        document.querySelectorAll(".tile-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        updateRotateBtn();
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
    updateRotateBtn();
  };
  panel.appendChild(fundBtn);
}

// ── MODAL SİSTEMİ ─────────────────────────────────────────────────────────────
function showModal(title, bodyHtml, onConfirm) {
  let overlay = document.getElementById("game-modal-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "game-modal-overlay";
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;z-index:200;padding:1rem;`;
    document.body.appendChild(overlay);
  }
  overlay.style.display = "flex";
  overlay.innerHTML = `
    <div style="background:#161b22;border:1px solid #30363d;border-radius:10px;
      padding:1.5rem;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <div style="font-weight:600;font-size:15px;">${title}</div>
        <button id="modal-close" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:18px;padding:0 4px;">✕</button>
      </div>
      <div id="modal-body">${bodyHtml}</div>
    </div>`;
  overlay.querySelector("#modal-close").onclick = closeModal;
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
}
function closeModal() {
  const o = document.getElementById("game-modal-overlay");
  if (o) o.style.display = "none";
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg, type="info") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove("show"), 3000);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function canPlaceHere(x, y) {
  if (!gameState) return false;
  const gs = gameState.gridSize || 20;
  if (x < 0 || y < 0 || x >= gs || y >= gs) return false;
  const existing = gameState.tiles?.[`${x},${y}`];
  if (!existing) return true;
  const existDef = TILES[existing.type];
  if (existDef?.isRoad && selectedTile && TILES[selectedTile]?.isRoad) return true;
  return false;
}

function getPlayerColor(uid) {
  return roomData?.players?.[uid]?.color || "#8b949e";
}

function shadeColor(hex, amount) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const c = v => Math.max(0,Math.min(255,v));
  return `rgb(${c(r+amount)},${c(g+amount)},${c(b+amount)})`;
}
