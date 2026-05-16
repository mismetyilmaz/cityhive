// firebase-manager.js — v2

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInAnonymously, updateProfile, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, push, update, remove,
  onValue, onDisconnect, serverTimestamp, off
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

export const PLAYER_COLORS = [
  "#E85D04","#3A86FF","#8338EC","#06D6A0",
  "#FF006E","#FFBE0B","#FB5607","#43AA8B"
];

export const STARTING_BUDGET = 50000;
export const EXPAND_COST     = 20000;

// ── AUTH ──────────────────────────────────────────────────────────────────────
export async function signIn(displayName) {
  const cred = await signInAnonymously(auth);
  await updateProfile(cred.user, { displayName });
  await set(ref(db, `users/${cred.user.uid}`), {
    displayName, currentRoom: null, lastSeen: serverTimestamp()
  });
  return cred.user;
}
export function onAuthChange(cb) { return onAuthStateChanged(auth, cb); }
export function getCurrentUser() { return auth.currentUser; }

// ── ODA ───────────────────────────────────────────────────────────────────────
export async function createRoom(roomName, maxPlayers = 4) {
  const user = auth.currentUser;
  if (!user) throw new Error("Giriş yapılmamış");
  const roomRef = push(ref(db, "rooms"));
  const roomId  = roomRef.key;
  await set(roomRef, {
    meta: { name: roomName, host: user.uid, status: "waiting",
            createdAt: serverTimestamp(), maxPlayers },
    players: {
      [user.uid]: { name: user.displayName, color: PLAYER_COLORS[0],
                    ready: false, joinedAt: serverTimestamp() }
    }
  });
  await update(ref(db, `users/${user.uid}`), { currentRoom: roomId });
  onDisconnect(ref(db, `rooms/${roomId}/players/${user.uid}`)).remove();
  return roomId;
}

export async function joinRoom(roomId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Giriş yapılmamış");
  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
  if (!metaSnap.exists()) throw new Error("Oda bulunamadı");
  const meta = metaSnap.val();
  if (meta.status !== "waiting") throw new Error("Oyun başlamış");
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const existing    = playersSnap.exists() ? playersSnap.val() : {};
  const count       = Object.keys(existing).length;
  if (count >= meta.maxPlayers) throw new Error("Oda dolu");
  const usedColors  = Object.values(existing).map(p => p.color);
  const color = PLAYER_COLORS.find(c => !usedColors.includes(c)) || PLAYER_COLORS[count % PLAYER_COLORS.length];
  await set(ref(db, `rooms/${roomId}/players/${user.uid}`), {
    name: user.displayName, color, ready: false, joinedAt: serverTimestamp()
  });
  await update(ref(db, `users/${user.uid}`), { currentRoom: roomId });
  onDisconnect(ref(db, `rooms/${roomId}/players/${user.uid}`)).remove();
  return roomId;
}

export async function leaveRoom(roomId) {
  const user = auth.currentUser;
  if (!user) return;
  await remove(ref(db, `rooms/${roomId}/players/${user.uid}`));
  await update(ref(db, `users/${user.uid}`), { currentRoom: null });
  const snap = await get(ref(db, `rooms/${roomId}/players`));
  if (!snap.exists()) {
    await remove(ref(db, `rooms/${roomId}`));
  } else {
    const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
    if (metaSnap.val().host === user.uid)
      await update(ref(db, `rooms/${roomId}/meta`), { host: Object.keys(snap.val())[0] });
  }
}

export async function setReady(roomId, ready) {
  const user = auth.currentUser;
  if (!user) return;
  await update(ref(db, `rooms/${roomId}/players/${user.uid}`), { ready });
}

// ── OYUN BAŞLAT ───────────────────────────────────────────────────────────────
export async function startGame(roomId) {
  const user     = auth.currentUser;
  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
  if (metaSnap.val().host !== user.uid) throw new Error("Sadece host başlatabilir");

  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const players     = playersSnap.val();
  const budgets = {};
  Object.keys(players).forEach(uid => { budgets[uid] = STARTING_BUDGET; });

  await update(ref(db, `rooms/${roomId}/meta`), { status: "playing", startedAt: serverTimestamp() });
  await set(ref(db, `rooms/${roomId}/gameState`), {
    gridSize:         20,
    tiles:            {},
    budgets,
    fund:             { balance: 0, expansionFund: 0 },
    demolishRequests: {},
    pendingExpansion: null
  });
}

// ── TİLE ──────────────────────────────────────────────────────────────────────
export async function placeTile(roomId, x, y, tileType, cost) {
  const user = auth.currentUser;
  if (!user) throw new Error("Giriş yapılmamış");
  const key = `${x},${y}`;

  const gsSnap = await get(ref(db, `rooms/${roomId}/gameState`));
  const gs = gsSnap.val();
  const budget = gs.budgets?.[user.uid] ?? 0;
  if (budget < cost) throw new Error(`Yetersiz bütçe (${budget.toLocaleString()}₺ / ${cost.toLocaleString()}₺)`);

  const existing = gs.tiles?.[key];

  // Yol tanımlarını import edemeyiz burada, type string'den kontrol
  const isRoadType = tileType.startsWith("road_");
  const existingIsRoad = existing?.type?.startsWith("road_");

  if (existing) {
    if (isRoadType && existingIsRoad) {
      // Yol üzerine farklı yol tipini uygula (değiştir)
    } else if (!isRoadType && existingIsRoad) {
      throw new Error("Yol üzerine bina inşa edilemez");
    } else {
      throw new Error("Bu alanda zaten bir yapı var");
    }
  }

  // Yollar anında yerleşir (building: false), binalar inşaat animasyonuyla
  const isRoad = isRoadType;

  await update(ref(db, `rooms/${roomId}/gameState`), {
    [`tiles/${key}`]: {
      type: tileType, ownerId: user.uid, ownerName: user.displayName,
      builtAt: serverTimestamp(), building: isRoad ? false : true, level: 1
    },
    [`budgets/${user.uid}`]: budget - cost
  });
  return key;
}

export async function finishBuilding(roomId, key) {
  await update(ref(db, `rooms/${roomId}/gameState/tiles/${key}`), { building: false });
}

// ── YIKIM ─────────────────────────────────────────────────────────────────────
export async function demolishOwn(roomId, x, y) {
  const user = auth.currentUser;
  const key  = `${x},${y}`;
  const tileSnap = await get(ref(db, `rooms/${roomId}/gameState/tiles/${key}`));
  if (!tileSnap.exists()) throw new Error("Tile bulunamadı");
  if (tileSnap.val().ownerId !== user.uid) throw new Error("Bu yapı sana ait değil");
  await remove(ref(db, `rooms/${roomId}/gameState/tiles/${key}`));
}

export async function requestDemolish(roomId, x, y) {
  const user = auth.currentUser;
  const key  = `${x},${y}`;
  const tileSnap = await get(ref(db, `rooms/${roomId}/gameState/tiles/${key}`));
  if (!tileSnap.exists()) throw new Error("Tile bulunamadı");
  const tile = tileSnap.val();
  if (tile.ownerId === user.uid) throw new Error("Kendi tile'ını direkt yıkabilirsin");
  const reqId = `${user.uid}_${x}_${y}`;
  await set(ref(db, `rooms/${roomId}/gameState/demolishRequests/${reqId}`), {
    requesterUid: user.uid, requesterName: user.displayName,
    targetUid: tile.ownerId, tileKey: key, tileType: tile.type,
    status: "pending", createdAt: serverTimestamp()
  });
}

export async function respondDemolish(roomId, reqId, accept) {
  const user   = auth.currentUser;
  const reqRef = ref(db, `rooms/${roomId}/gameState/demolishRequests/${reqId}`);
  const snap   = await get(reqRef);
  if (!snap.exists()) throw new Error("İstek bulunamadı");
  const req = snap.val();
  if (req.targetUid !== user.uid) throw new Error("Bu istek sana değil");
  if (accept) {
    await remove(ref(db, `rooms/${roomId}/gameState/tiles/${req.tileKey}`));
    await remove(reqRef);
  } else {
    await update(reqRef, { status: "rejected" });
    setTimeout(() => remove(reqRef), 4000);
  }
}

// ── FON BİNASI ────────────────────────────────────────────────────────────────
export async function transferToFund(roomId, amount) {
  const user = auth.currentUser;
  const gsSnap = await get(ref(db, `rooms/${roomId}/gameState`));
  const gs = gsSnap.val();
  const myBudget = gs.budgets?.[user.uid] ?? 0;
  if (myBudget < amount) throw new Error("Yetersiz bütçe");
  await update(ref(db, `rooms/${roomId}/gameState`), {
    [`budgets/${user.uid}`]: myBudget - amount,
    "fund/balance": (gs.fund?.balance ?? 0) + amount
  });
}

export async function transferFromFund(roomId, toUid, amount) {
  const gsSnap = await get(ref(db, `rooms/${roomId}/gameState`));
  const gs = gsSnap.val();
  const bal = gs.fund?.balance ?? 0;
  if (bal < amount) throw new Error("Fonda yeterli para yok");
  await update(ref(db, `rooms/${roomId}/gameState`), {
    "fund/balance": bal - amount,
    [`budgets/${toUid}`]: (gs.budgets?.[toUid] ?? 0) + amount
  });
}

export async function transferBetweenPlayers(roomId, toUid, amount) {
  const user = auth.currentUser;
  const gsSnap = await get(ref(db, `rooms/${roomId}/gameState`));
  const gs = gsSnap.val();
  const from = gs.budgets?.[user.uid] ?? 0;
  if (from < amount) throw new Error("Yetersiz bütçe");
  await update(ref(db, `rooms/${roomId}/gameState`), {
    [`budgets/${user.uid}`]: from - amount,
    [`budgets/${toUid}`]:    (gs.budgets?.[toUid] ?? 0) + amount
  });
}

export async function addToExpansionFund(roomId, amount) {
  const user = auth.currentUser;
  const gsSnap = await get(ref(db, `rooms/${roomId}/gameState`));
  const gs = gsSnap.val();
  const myBudget = gs.budgets?.[user.uid] ?? 0;
  if (myBudget < amount) throw new Error("Yetersiz bütçe");
  await update(ref(db, `rooms/${roomId}/gameState`), {
    [`budgets/${user.uid}`]: myBudget - amount,
    "fund/expansionFund": (gs.fund?.expansionFund ?? 0) + amount
  });
}

// ── ŞEHİR GENİŞLETME ─────────────────────────────────────────────────────────
export async function requestExpansion(roomId, direction) {
  const user = auth.currentUser;
  const gsSnap = await get(ref(db, `rooms/${roomId}/gameState`));
  const gs = gsSnap.val();
  if ((gs.fund?.expansionFund ?? 0) < EXPAND_COST)
    throw new Error(`Expansion fonu yetersiz. Gereken: ${EXPAND_COST.toLocaleString()}₺`);
  if (gs.pendingExpansion)
    throw new Error("Zaten bekleyen bir genişletme isteği var");

  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const votes = {};
  Object.keys(playersSnap.val()).forEach(uid => { votes[uid] = uid === user.uid; });

  await update(ref(db, `rooms/${roomId}/gameState`), {
    pendingExpansion: {
      direction, cost: EXPAND_COST, requestedBy: user.uid,
      requestedByName: user.displayName, votes
    }
  });
}

export async function voteExpansion(roomId, approve) {
  const user = auth.currentUser;
  await update(ref(db, `rooms/${roomId}/gameState/pendingExpansion/votes`), { [user.uid]: approve });

  const [pendingSnap, playersSnap] = await Promise.all([
    get(ref(db, `rooms/${roomId}/gameState/pendingExpansion`)),
    get(ref(db, `rooms/${roomId}/players`))
  ]);
  const pending     = pendingSnap.val();
  const totalP      = Object.keys(playersSnap.val()).length;
  const allVotes    = Object.values(pending.votes);
  if (allVotes.length < totalP) return; // Herkese bekliyoruz

  if (allVotes.every(v => v)) {
    // Onaylandı
    const gsSnap = await get(ref(db, `rooms/${roomId}/gameState`));
    const gs = gsSnap.val();
    await update(ref(db, `rooms/${roomId}/gameState`), {
      gridSize: gs.gridSize + 4,
      "fund/expansionFund": (gs.fund?.expansionFund ?? 0) - pending.cost,
      pendingExpansion: null
    });
  } else {
    await remove(ref(db, `rooms/${roomId}/gameState/pendingExpansion`));
  }
}

// ── DİNLEYİCİLER ─────────────────────────────────────────────────────────────
export function listenToRooms(callback, onError) {
  const r = ref(db, "rooms");
  onValue(r, snap => {
    const rooms = [];
    if (snap.exists()) snap.forEach(child => {
      const d = child.val();
      if (d.meta?.status === "waiting")
        rooms.push({ id: child.key, name: d.meta.name, host: d.meta.host,
          playerCount: d.players ? Object.keys(d.players).length : 0,
          maxPlayers: d.meta.maxPlayers });
    });
    callback(rooms);
  }, err => {
    console.error("listenToRooms error:", err);
    if (onError) onError(err);
  });
  return () => off(r);
}

export function listenToRoom(roomId, callback) {
  const r = ref(db, `rooms/${roomId}`);
  onValue(r, snap => callback(snap.exists() ? snap.val() : null));
  return () => off(r);
}

export function listenToGameState(roomId, callback) {
  const r = ref(db, `rooms/${roomId}/gameState`);
  onValue(r, snap => { if (snap.exists()) callback(snap.val()); });
  return () => off(r);
}
