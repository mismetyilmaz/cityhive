// app.js — Ana uygulama mantığı

import {
  signIn,
  onAuthChange,
  getCurrentUser,
  createRoom,
  joinRoom,
  leaveRoom,
  setReady,
  startGame,
  listenToRooms,
  listenToRoom,
  updateGameState
} from "./firebase-manager.js";

// --- State ---
let currentUser = null;
let currentRoomId = null;
let unsubRooms = null;
let unsubRoom = null;
let roomData = null;

// --- Screen manager ---
const screens = {
  login: document.getElementById("screen-login"),
  lobby: document.getElementById("screen-lobby"),
  waiting: document.getElementById("screen-waiting"),
  game: document.getElementById("screen-game"),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  if (screens[name]) screens[name].classList.add("active");
}

// --- Toast ---
function toast(msg, type = "info", duration = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), duration);
}

// --- Login Screen ---
document.getElementById("btn-login").addEventListener("click", async () => {
  const name = document.getElementById("input-name").value.trim();
  if (!name || name.length < 2) {
    toast("En az 2 karakter gir", "error");
    return;
  }
  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  btn.textContent = "Bağlanılıyor...";
  try {
    currentUser = await signIn(name);
    showLobby();
  } catch (e) {
    toast("Giriş hatası: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Giriş Yap";
  }
});

document.getElementById("input-name").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-login").click();
});

// --- Lobby Screen ---
function showLobby() {
  showScreen("lobby");
  document.getElementById("lobby-username").textContent = currentUser.displayName;

  // Rooms listener
  if (unsubRooms) unsubRooms();
  unsubRooms = listenToRooms(renderRoomList);
}

function renderRoomList(rooms) {
  const list = document.getElementById("room-list");
  const counter = document.getElementById("rooms-count");
  counter.textContent = `${rooms.length} oda`;

  if (rooms.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">🏙️</div>
        <div>Henüz oda yok</div>
        <div style="margin-top:4px; font-size:11px;">İlk şehri sen kur!</div>
      </div>`;
    return;
  }

  list.innerHTML = rooms.map(room => {
    const full = room.playerCount >= room.maxPlayers;
    const badgeClass = full ? "badge-full" : "badge-waiting";
    const badgeText = full ? "Dolu" : "Bekliyor";
    return `
      <div class="room-item" data-id="${room.id}" ${full ? "style='opacity:0.5;cursor:not-allowed'" : ""}>
        <div class="room-info">
          <div class="room-name">${escHtml(room.name)}</div>
          <div class="room-meta">
            <span>👥 ${room.playerCount}/${room.maxPlayers}</span>
            <span class="badge ${badgeClass}">${badgeText}</span>
          </div>
        </div>
        <button class="btn btn-primary btn-join" data-id="${room.id}" ${full ? "disabled" : ""}>Katıl</button>
      </div>`;
  }).join("");

  list.querySelectorAll(".btn-join").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Katılınıyor...";
      try {
        await joinRoom(id);
        currentRoomId = id;
        showWaitingRoom(id);
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
        btn.textContent = "Katıl";
      }
    });
  });
}

// Oda ID ile katılma
document.getElementById("btn-join-code").addEventListener("click", async () => {
  const code = document.getElementById("input-room-code").value.trim().toUpperCase();
  if (!code) { toast("Oda kodu gir", "error"); return; }
  const btn = document.getElementById("btn-join-code");
  btn.disabled = true;
  try {
    await joinRoom(code);
    currentRoomId = code;
    showWaitingRoom(code);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// Oda oluşturma modal
document.getElementById("btn-create-room").addEventListener("click", () => {
  document.getElementById("create-modal").style.display = "flex";
});

document.getElementById("btn-cancel-create").addEventListener("click", () => {
  document.getElementById("create-modal").style.display = "none";
});

document.getElementById("btn-confirm-create").addEventListener("click", async () => {
  const name = document.getElementById("input-room-name").value.trim();
  const maxP = parseInt(document.getElementById("input-max-players").value);
  if (!name) { toast("Oda adı gir", "error"); return; }

  const btn = document.getElementById("btn-confirm-create");
  btn.disabled = true;
  btn.textContent = "Oluşturuluyor...";
  try {
    const roomId = await createRoom(name, maxP);
    currentRoomId = roomId;
    document.getElementById("create-modal").style.display = "none";
    showWaitingRoom(roomId);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Oluştur";
  }
});

// --- Waiting Room Screen ---
function showWaitingRoom(roomId) {
  if (unsubRooms) { unsubRooms(); unsubRooms = null; }
  showScreen("waiting");

  const codeEl = document.getElementById("room-code-display");
  codeEl.textContent = roomId;
  codeEl.onclick = () => {
    navigator.clipboard.writeText(roomId).then(() => toast("Kod kopyalandı!", "success"));
  };

  if (unsubRoom) unsubRoom();
  unsubRoom = listenToRoom(roomId, (data) => {
    if (!data) {
      // Oda silindi
      toast("Oda kapatıldı", "error");
      cleanupRoom();
      showLobby();
      return;
    }
    roomData = data;
    renderWaitingRoom(data, roomId);

    // Oyun başladıysa oyun ekranına geç
    if (data.meta?.status === "playing") {
      if (unsubRoom) { unsubRoom(); unsubRoom = null; }
      showGameScreen(roomId, data);
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
    const isMe = uid === currentUser?.uid;
    const isRoomHost = uid === meta.host;
    return `
      <div class="player-card">
        <div class="player-color" style="background:${p.color}"></div>
        <span class="player-name">
          ${escHtml(p.name)}
          ${isRoomHost ? '<span class="host-crown" title="Host">👑</span>' : ""}
          ${isMe ? '<span style="color:var(--text2);font-size:11px;"> (sen)</span>' : ""}
        </span>
        <span class="ready-pill ${p.ready ? 'yes' : 'no'}">${p.ready ? "Hazır" : "Bekliyor"}</span>
      </div>`;
  }).join("");

  // Slot'lar
  const filled = Object.keys(players).length;
  for (let i = filled; i < meta.maxPlayers; i++) {
    playerList.innerHTML += `
      <div class="player-card" style="opacity:0.35">
        <div class="player-color" style="background:var(--border)"></div>
        <span class="player-name" style="color:var(--text2)">Boş slot</span>
      </div>`;
  }

  // Ready butonu
  const myData = players[currentUser?.uid];
  const btnReady = document.getElementById("btn-ready");
  if (myData) {
    btnReady.textContent = myData.ready ? "⏸ Hazır Değil" : "✅ Hazır";
    btnReady.className = myData.ready ? "btn btn-ghost btn-full" : "btn btn-success btn-full";
  }

  // Host: başlatma butonu
  const btnStart = document.getElementById("btn-start");
  btnStart.style.display = isHost ? "flex" : "none";
  const allReady = Object.values(players).filter(p => p.name !== myData?.name || isHost)
    .every(p => p.ready);
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
  try {
    await startGame(currentRoomId);
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
  }
});

document.getElementById("btn-leave-waiting").addEventListener("click", async () => {
  if (!currentRoomId) return;
  await leaveRoom(currentRoomId);
  cleanupRoom();
  showLobby();
});

// Chat (lokal + DB'de saklıyoruz sadelik için sadece UI'da)
const chatMessages = [];
document.getElementById("btn-chat-send").addEventListener("click", sendChatMsg);
document.getElementById("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter") sendChatMsg();
});

function sendChatMsg() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  appendChatMsg(currentUser.displayName, msg, currentUser.uid);
}

function appendChatMsg(sender, msg, uid) {
  const box = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = "chat-msg";
  const color = roomData?.players?.[uid]?.color || "#8b949e";
  div.innerHTML = `<span class="sender" style="color:${color}">${escHtml(sender)}</span>${escHtml(msg)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

export function appendSystemMsg(msg) {
  const box = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = "chat-msg chat-system";
  div.textContent = msg;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// --- Game Screen --- (sonraki aşamada doldurulacak)
function showGameScreen(roomId, data) {
  showScreen("game");
  document.getElementById("game-room-name").textContent = data.meta.name;
  document.getElementById("game-players").innerHTML = Object.values(data.players || {})
    .map(p => `<span class="player-dot" style="background:${p.color}" title="${p.name}"></span>`)
    .join("");
  toast("Oyun başlıyor!", "success");
  // game.js buradan devralır
  if (window.initGame) window.initGame(roomId, data, currentUser);
}

// --- Helpers ---
function cleanupRoom() {
  if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  currentRoomId = null;
  roomData = null;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Auth state restore ---
onAuthChange((user) => {
  if (user) {
    currentUser = user;
    if (screens.login.classList.contains("active") || !document.querySelector(".screen.active")) {
      showLobby();
    }
  } else {
    showScreen("login");
  }
});
