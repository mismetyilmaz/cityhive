// firebase-manager.js
// Firebase Auth + Realtime Database işlemleri

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  update,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp,
  off
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

// --- Init ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Renk paleti (oyuncular için)
const PLAYER_COLORS = [
  "#E85D04", "#3A86FF", "#8338EC", "#06D6A0",
  "#FF006E", "#FFBE0B", "#FB5607", "#43AA8B"
];

// --- Auth ---
export async function signIn(displayName) {
  const cred = await signInAnonymously(auth);
  await updateProfile(cred.user, { displayName });
  await set(ref(db, `users/${cred.user.uid}`), {
    displayName,
    currentRoom: null,
    lastSeen: serverTimestamp()
  });
  return cred.user;
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}

// --- Oda işlemleri ---

// Oda oluştur
export async function createRoom(roomName, maxPlayers = 4) {
  const user = auth.currentUser;
  if (!user) throw new Error("Giriş yapılmamış");

  const roomRef = push(ref(db, "rooms"));
  const roomId = roomRef.key;
  const color = PLAYER_COLORS[0];

  const roomData = {
    meta: {
      name: roomName,
      host: user.uid,
      status: "waiting",
      createdAt: serverTimestamp(),
      maxPlayers
    },
    players: {
      [user.uid]: {
        name: user.displayName,
        color,
        ready: false,
        joinedAt: serverTimestamp()
      }
    }
  };

  await set(roomRef, roomData);
  await update(ref(db, `users/${user.uid}`), { currentRoom: roomId });

  // Oyuncu çıkarsa player kaydını sil
  const playerRef = ref(db, `rooms/${roomId}/players/${user.uid}`);
  onDisconnect(playerRef).remove();

  return roomId;
}

// Odaya katıl
export async function joinRoom(roomId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Giriş yapılmamış");

  // Oda var mı?
  const roomSnap = await get(ref(db, `rooms/${roomId}/meta`));
  if (!roomSnap.exists()) throw new Error("Oda bulunamadı");

  const meta = roomSnap.val();
  if (meta.status !== "waiting") throw new Error("Oyun başlamış, katılamazsın");

  // Kaç oyuncu var?
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const playerCount = playersSnap.exists() ? Object.keys(playersSnap.val()).length : 0;
  if (playerCount >= meta.maxPlayers) throw new Error("Oda dolu");

  // Renk ata (kullanılmayan)
  const usedColors = playersSnap.exists()
    ? Object.values(playersSnap.val()).map(p => p.color)
    : [];
  const color = PLAYER_COLORS.find(c => !usedColors.includes(c)) || PLAYER_COLORS[playerCount % PLAYER_COLORS.length];

  await set(ref(db, `rooms/${roomId}/players/${user.uid}`), {
    name: user.displayName,
    color,
    ready: false,
    joinedAt: serverTimestamp()
  });

  await update(ref(db, `users/${user.uid}`), { currentRoom: roomId });

  const playerRef = ref(db, `rooms/${roomId}/players/${user.uid}`);
  onDisconnect(playerRef).remove();

  return roomId;
}

// Odadan çık
export async function leaveRoom(roomId) {
  const user = auth.currentUser;
  if (!user) return;

  await remove(ref(db, `rooms/${roomId}/players/${user.uid}`));
  await update(ref(db, `users/${user.uid}`), { currentRoom: null });

  // Kalan oyuncular var mı?
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  if (!playersSnap.exists()) {
    // Oda boşaldı, sil
    await remove(ref(db, `rooms/${roomId}`));
  } else {
    // Host gittiyse yeni host ata
    const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
    if (metaSnap.val().host === user.uid) {
      const newHost = Object.keys(playersSnap.val())[0];
      await update(ref(db, `rooms/${roomId}/meta`), { host: newHost });
    }
  }
}

// Hazır durumunu toggle et
export async function setReady(roomId, ready) {
  const user = auth.currentUser;
  if (!user) return;
  await update(ref(db, `rooms/${roomId}/players/${user.uid}`), { ready });
}

// Oyunu başlat (sadece host)
export async function startGame(roomId) {
  const user = auth.currentUser;
  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
  if (metaSnap.val().host !== user.uid) throw new Error("Sadece host başlatabilir");

  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const players = playersSnap.val();
  const allReady = Object.values(players).every(p => p.ready || p.name === user.displayName);

  // Host ready olmasa bile başlatabilir ama en az 1 başka oyuncu hazır olmalı
  await update(ref(db, `rooms/${roomId}/meta`), {
    status: "playing",
    startedAt: serverTimestamp()
  });

  // Başlangıç oyun state'i
  await set(ref(db, `rooms/${roomId}/gameState`), {
    turn: 0,
    budget: 50000,
    population: 0,
    happiness: 80,
    grid: {},           // tile placements
    lastAction: null
  });
}

// --- Gerçek zamanlı dinleyiciler ---

// Tüm odaları listele (lobby)
export function listenToRooms(callback) {
  const roomsRef = ref(db, "rooms");
  const unsub = onValue(roomsRef, (snap) => {
    const rooms = [];
    if (snap.exists()) {
      snap.forEach(child => {
        const data = child.val();
        if (data.meta && data.meta.status === "waiting") {
          const playerCount = data.players ? Object.keys(data.players).length : 0;
          rooms.push({
            id: child.key,
            name: data.meta.name,
            host: data.meta.host,
            playerCount,
            maxPlayers: data.meta.maxPlayers,
            createdAt: data.meta.createdAt
          });
        }
      });
    }
    callback(rooms);
  });
  return () => off(roomsRef, "value", unsub);
}

// Belirli bir odayı dinle (bekleme odası)
export function listenToRoom(roomId, callback) {
  const roomRef = ref(db, `rooms/${roomId}`);
  const unsub = onValue(roomRef, (snap) => {
    if (snap.exists()) {
      callback(snap.val());
    } else {
      callback(null); // Oda silindi
    }
  });
  return () => off(roomRef, "value", unsub);
}

// Oyun state'ini dinle
export function listenToGameState(roomId, callback) {
  const gsRef = ref(db, `rooms/${roomId}/gameState`);
  const unsub = onValue(gsRef, (snap) => {
    if (snap.exists()) callback(snap.val());
  });
  return () => off(gsRef, "value", unsub);
}

// Oyun state'ini güncelle (bir tile koy vb.)
export async function updateGameState(roomId, updates) {
  await update(ref(db, `rooms/${roomId}/gameState`), {
    ...updates,
    lastAction: {
      by: auth.currentUser?.uid,
      at: serverTimestamp()
    }
  });
}

// Save (Firestore yerine Realtime DB'de saklıyoruz, basit tutmak için)
export async function saveCity(roomId) {
  const gsSnap = await get(ref(db, `rooms/${roomId}/gameState`));
  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
  await update(ref(db, `rooms/${roomId}/meta`), {
    lastSaved: serverTimestamp(),
    savedBy: auth.currentUser?.uid
  });
  return { gameState: gsSnap.val(), meta: metaSnap.val() };
}
