// app.js — Ana uygulama (lobby + waiting room + game init)

import {
  signIn, onAuthChange, getCurrentUser,
  createRoom, joinRoom, leaveRoom, setReady, startGame,
  listenToRooms, listenToRoom
} from "./firebase-manager.js";

import { initGame } from "./game.js";

// ── STATE ─────────────────────────────────────────────────────────────────────
let currentUser   = null;
let currentRoomId = null;
let unsubRooms    = null;
let unsubRoom     = null;
let roomData      = null;

// ── SCREEN MANAGER ────────────────────────────────────────────────────────────
const screens = {
  login:   document.getElementById("screen-login"),
  lobby:   document.getElementById("screen-lobby"),
  waiting: document.getElementById("screen-waiting"),
  game:    document.getElementById("screen-game"),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  if (screens[name]) screens[name].classList.add("active");
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function toast(msg, type = "info", duration = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), duration);
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
document.getElementById("btn-login").addEventListener("click", async () => {
  const name = document.getElementById("input-name").value.trim();
  if (!name || name.length < 2) { toast("En az 2 karakter gir", "error"); return; }
  const btn = document.getElementById("btn-login");
  btn.disabled    = true;
  btn.textContent = "Bağlanılıyor...";
  try {
    currentUser = await signIn(name);
    showLobby();
  } catch (e) {
    toast("Giriş hatası: " + e.message, "error");
  } finally {
    btn.disabled    = false;
    btn.textContent = "Giriş Yap →";
  }
});

document.getElementById("input-name")
  .addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("btn-login").click(); });

// ── LOBBY ─────────────────────────────────────────────────────────────────────
function showLobby() {
  showScreen("lobby");
  document.getElementById("lobby-username").textContent = currentUser.displayName;
  if (unsubRooms) unsubRooms();
  unsubRooms = listenToRooms(renderRoomList, (err) => {
    const list = document.getElementById("room-list");
    if (list) list.innerHTML = `
      <div class="empty-state">
        <div style="font-size:2rem;margin-bottom:8px;">⚠️</div>
        <div style="color:var(--danger);font-weight:600;margin-bottom:6px;">Firebase bağlantı hatası</div>
        <div style="font-size:11px;color:var(--text2);line-height:1.6;">
          ${err.code === "PERMISSION_DENIED"
            ? "Veritabanı izin reddedildi.<br>Firebase Console → Realtime Database → Rules kısmını kontrol et."
            : "Bağlantı kurulamadı: " + err.message}
        </div>
        <button class="btn btn-ghost" style="margin-top:12px;font-size:12px;" onclick="location.reload()">Yeniden Dene</button>
      </div>`;
    toast(err.code === "PERMISSION_DENIED" ? "DB izni yok — Firebase kurallarını kontrol et" : "Bağlantı hatası", "error");
  });
}

function renderRoomList(rooms) {
  const list    = document.getElementById("room-list");
  const counter = document.getElementById("rooms-count");
  counter.textContent = `${rooms.length} oda`;

  if (rooms.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">🏙️</div>
        <div>Henüz oda yok</div>
        <div style="margin-top:4px;font-size:11px;">İlk şehri sen kur!</div>
      </div>`;
    return;
  }

  list.innerHTML = rooms.map(room => {
    const full      = room.playerCount >= room.maxPlayers;
    const badgeCls  = full ? "badge-full" : "badge-waiting";
    const badgeTxt  = full ? "Dolu" : "Bekliyor";
    return `
      <div class="room-item" data-id="${room.id}" ${full ? "style='opacity:0.5;cursor:not-allowed'" : ""}>
        <div class="room-info">
          <div class="room-name">${esc(room.name)}</div>
          <div class="room-meta">
            <span>👥 ${room.playerCount}/${room.maxPlayers}</span>
            <span class="badge ${badgeCls}">${badgeTxt}</span>
          </div>
        </div>
        <button class="btn btn-primary btn-join" data-id="${room.id}" ${full ? "disabled" : ""}>Katıl</button>
      </div>`;
  }).join("");

  list.querySelectorAll(".btn-join").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      if (btn.disabled) return;
      btn.disabled    = true;
      btn.textContent = "Katılınıyor...";
      try {
        await joinRoom(btn.dataset.id);
        currentRoomId = btn.dataset.id;
        showWaitingRoom(currentRoomId);
      } catch (err) {
        toast(err.message, "error");
        btn.disabled    = false;
        btn.textContent = "Katıl";
      }
    });
  });
}

// Kod ile katıl
document.getElementById("btn-join-code").addEventListener("click", async () => {
  const code = document.getElementById("input-room-code").value.trim().toUpperCase();
  if (!code) { toast("Oda kodu gir", "error"); return; }
  const btn = document.getElementById("btn-join-code");
  btn.disabled = true;
  try {
    await joinRoom(code);
    currentRoomId = code;
    showWaitingRoom(code);
  } catch (err) { toast(err.message, "error"); }
  finally      { btn.disabled = false; }
});

document.getElementById("input-room-code")
  .addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("btn-join-code").click(); });

// Oda oluştur
document.getElementById("btn-create-room")
  .addEventListener("click", () => { document.getElementById("create-modal").style.display = "flex"; });

document.getElementById("btn-cancel-create")
  .addEventListener("click", () => { document.getElementById("create-modal").style.display = "none"; });

document.getElementById("btn-confirm-create").addEventListener("click", async () => {
  const name = document.getElementById("input-room-name").value.trim();
  const maxP = parseInt(document.getElementById("input-max-players").value);
  if (!name) { toast("Oda adı gir", "error"); return; }
  const btn = document.getElementById("btn-confirm-create");
  btn.disabled    = true;
  btn.textContent = "Oluşturuluyor...";
  try {
    const roomId = await createRoom(name, maxP);
    currentRoomId = roomId;
    document.getElementById("create-modal").style.display = "none";
    showWaitingRoom(roomId);
  } catch (err) { toast(err.message, "error"); }
  finally       { btn.disabled = false; btn.textContent = "Oluştur"; }
});

// ── WAITING ROOM ──────────────────────────────────────────────────────────────
function showWaitingRoom(roomId) {
  if (unsubRooms) { unsubRooms(); unsubRooms = null; }
  showScreen("waiting");

  // Oda kodunu göster + kopyala
  const codeEl = document.getElementById("room-code-display");
  codeEl.textContent = roomId;
  codeEl.onclick = () => {
    navigator.clipboard.writeText(roomId).then(() => toast("Kod kopyalandı!", "success"));
  };

  if (unsubRoom) unsubRoom();
  unsubRoom = listenToRoom(roomId, data => {
    if (!data) {
      toast("Oda kapatıldı", "error");
      cleanupRoom();
      showLobby();
      return;
    }
    roomData = data;
    renderWaitingRoom(data, roomId);

    if (data.meta?.status === "playing") {
      if (unsubRoom) { unsubRoom(); unsubRoom = null; }
      launchGame(roomId, data);
    }
  });
}

function renderWaitingRoom(data, roomId) {
  const { meta, players } = data;
  if (!meta || !players) return;

  document.getElementById("waiting-room-name").textContent = meta.name;
  const isHost = meta.host === currentUser?.uid;

  // Oyuncu listesi
  const playerList = document.getElementById("player-list");
  playerList.innerHTML = Object.entries(players).map(([uid, p]) => {
    const isMe      = uid === currentUser?.uid;
    const isRoomHost = uid === meta.host;
    return `
      <div class="player-card">
        <div class="player-color" style="background:${p.color}"></div>
        <span class="player-name">
          ${esc(p.name)}
          ${isRoomHost ? '<span class="host-crown" title="Host">👑</span>' : ""}
          ${isMe ? '<span style="color:var(--text2);font-size:11px;"> (sen)</span>' : ""}
        </span>
        <span class="ready-pill ${p.ready ? "yes" : "no"}">${p.ready ? "Hazır" : "Bekliyor"}</span>
      </div>`;
  }).join("") + Array.from({ length: Math.max(0, meta.maxPlayers - Object.keys(players).length) })
    .map(() => `
      <div class="player-card" style="opacity:0.35">
        <div class="player-color" style="background:var(--border)"></div>
        <span class="player-name" style="color:var(--text2)">Boş slot</span>
      </div>`).join("");

  // Ready butonu
  const myData  = players[currentUser?.uid];
  const btnReady = document.getElementById("btn-ready");
  if (myData) {
    btnReady.textContent = myData.ready ? "⏸ Hazır Değil" : "✅ Hazır";
    btnReady.className   = myData.ready
      ? "btn btn-ghost btn-full"
      : "btn btn-success btn-full";
  }

  // Host: başlat butonu
  const btnStart = document.getElementById("btn-start");
  btnStart.style.display = isHost ? "flex" : "none";
  btnStart.disabled = Object.keys(players).length < 1;
}

document.getElementById("btn-ready").addEventListener("click", async () => {
  if (!currentRoomId || !roomData?.players?.[currentUser?.uid]) return;
  const current = roomData.players[currentUser.uid].ready;
  await setReady(currentRoomId, !current);
});

document.getElementById("btn-start").addEventListener("click", async () => {
  const btn = document.getElementById("btn-start");
  btn.disabled = true;
  try      { await startGame(currentRoomId); }
  catch(e) { toast(e.message, "error"); btn.disabled = false; }
});

document.getElementById("btn-leave-waiting").addEventListener("click", async () => {
  if (!currentRoomId) return;
  await leaveRoom(currentRoomId);
  cleanupRoom();
  showLobby();
});

// Chat (lokal — sonraki versiyonda Firebase'e taşınabilir)
document.getElementById("btn-chat-send").addEventListener("click", sendChat);
document.getElementById("chat-input")
  .addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });

function sendChat() {
  const input = document.getElementById("chat-input");
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = "";
  appendChat(currentUser.displayName, msg, currentUser.uid);
}

function appendChat(sender, msg, uid) {
  const box   = document.getElementById("chat-messages");
  const div   = document.createElement("div");
  const color = roomData?.players?.[uid]?.color || "#8b949e";
  div.className = "chat-msg";
  div.innerHTML = `<span class="sender" style="color:${color}">${esc(sender)}</span>${esc(msg)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// ── OYUN BAŞLATMA ─────────────────────────────────────────────────────────────
function launchGame(roomId, data) {
  showScreen("game");
  document.getElementById("game-room-name").textContent = data.meta.name;

  // Oyuncu noktaları
  document.getElementById("game-players").innerHTML =
    Object.values(data.players || {}).map(p =>
      `<span class="player-dot" style="background:${p.color}" title="${p.name}"></span>`
    ).join("");

  // Canvas boyutlandır
  const cont   = document.getElementById("game-canvas-container");
  const canvas = document.getElementById("game-canvas");
  canvas.width  = cont.clientWidth;
  canvas.height = cont.clientHeight;

  toast("Oyun başlıyor! 🏙️", "success");
  initGame(roomId, data, currentUser);
}

// ── CLEANUP ───────────────────────────────────────────────────────────────────
function cleanupRoom() {
  if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  currentRoomId = null;
  roomData      = null;
}

function esc(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── AUTH RESTORE ──────────────────────────────────────────────────────────────
onAuthChange(user => {
  if (user) {
    currentUser = user;
    const anyActive = document.querySelector(".screen.active");
    if (!anyActive || screens.login.classList.contains("active")) showLobby();
  } else {
    showScreen("login");
  }
});
