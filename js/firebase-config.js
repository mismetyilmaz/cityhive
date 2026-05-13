// firebase-config.js
// Firebase projesini oluşturduktan sonra bu değerleri güncelle:
// https://console.firebase.google.com → Project Settings → Your Apps → Web App

export const firebaseConfig = {
    apiKey: "AIzaSyB21lIo-rn7THohxqhYdmmaasXDL2VNuxE",
    authDomain: "cityhive-game.firebaseapp.com",
    databaseURL: "https://cityhive-game-default-rtdb.firebaseio.com",
    projectId: "cityhive-game",
    storageBucket: "cityhive-game.firebasestorage.app",
    messagingSenderId: "895307956293",
    appId: "1:895307956293:web:92153def9f32a635b4232c",
    measurementId: "G-BS8V5EYVP3"
  };

// Realtime Database veri yapısı:
//
// rooms/
//   {roomId}/
//     meta/
//       name: string
//       host: uid
//       status: "waiting" | "playing" | "finished"
//       createdAt: timestamp
//       maxPlayers: number (default 4)
//     players/
//       {uid}/
//         name: string
//         color: string
//         ready: boolean
//         joinedAt: timestamp
//     gameState/
//       (oyun başladıktan sonra dolar)
//
// users/
//   {uid}/
//     displayName: string
//     currentRoom: roomId | null
