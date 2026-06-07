// ============================================================================
//  SUNUCU GİRİŞ NOKTASI — Express (statik client) + Socket.IO (realtime)
//  Hamachi üzerinden çalışır: host bu sunucuyu çalıştırır, diğerleri
//  http://<hamachi-ip>:3000 adresine bağlanır.
// ============================================================================

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import { Game, PHASE } from './game.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
//  ODA / LOBİ KAYITDEFTERİ
// ---------------------------------------------------------------------------
const games = new Map(); // code -> Game
const sockets = new Map(); // socket.id -> { code, playerId }

function genCode() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (games.has(code));
  return code;
}

// Belirli bir oyuncunun (tüm) soketlerine olay gönder
function relayToPlayer(code, playerId, event, payload) {
  for (const [sid, info] of sockets.entries()) {
    if (info.code === code && info.playerId === playerId) {
      io.to(sid).emit(event, payload);
    }
  }
}

// Sesli sohbet mesh'i için tam oyuncu listesi (konum sızdırmaz, sadece kimlik)
function emitRoster(code) {
  const game = games.get(code);
  if (!game) return;
  const roster = [...game.players.values()]
    .filter((p) => p.connected)
    .map((p) => ({ playerId: p.id, name: p.name }));
  io.to(`room:${code}`).emit('voice:roster', { roster });
}

// Game.broadcast imzası: (event, payload, targetPlayerId?)
function makeBroadcast(code) {
  return (event, payload, targetPlayerId = null) => {
    const game = games.get(code);
    if (!game) return;
    if (targetPlayerId) {
      // Hedef oyuncunun aktif soketini bul
      for (const [sid, info] of sockets.entries()) {
        if (info.code === code && info.playerId === targetPlayerId) {
          io.to(sid).emit(event, payload);
        }
      }
    } else {
      io.to(`room:${code}`).emit(event, payload);
    }
  };
}

// ---------------------------------------------------------------------------
//  SOCKET HANDLER'LARI
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  const ack = (cb, result) => { if (typeof cb === 'function') cb(result); };

  function currentGame() {
    const info = sockets.get(socket.id);
    if (!info) return null;
    return games.get(info.code);
  }
  function currentPlayerId() {
    return sockets.get(socket.id)?.playerId || null;
  }

  // --- Oda kurma ---
  socket.on('lobby:create', ({ name, playerId }, cb) => {
    const code = genCode();
    const game = new Game(code, playerId, makeBroadcast(code));
    games.set(code, game);
    game.addPlayer(playerId, (name || 'Oyuncu').slice(0, 20));
    sockets.set(socket.id, { code, playerId });
    socket.join(`room:${code}`);
    ack(cb, { ok: true, code });
    game.pushStateTo(playerId);
    pushLobby(code);
    emitRoster(code);
  });

  // --- Odaya katılma ---
  socket.on('lobby:join', ({ name, code, playerId }, cb) => {
    code = (code || '').toUpperCase().trim();
    const game = games.get(code);
    if (!game) return ack(cb, { error: 'Oda bulunamadı.' });
    if (game.phase !== PHASE.LOBBY && !game.players.has(playerId)) {
      return ack(cb, { error: 'Oyun başladı, yeni oyuncu alınamıyor.' });
    }
    game.addPlayer(playerId, (name || 'Oyuncu').slice(0, 20));
    sockets.set(socket.id, { code, playerId });
    socket.join(`room:${code}`);
    ack(cb, { ok: true, code });
    game.pushStateTo(playerId);
    pushLobby(code);
    emitRoster(code);
  });

  // --- Yeniden bağlanma (reconnect) ---
  socket.on('lobby:reconnect', ({ code, playerId }, cb) => {
    code = (code || '').toUpperCase().trim();
    const game = games.get(code);
    if (!game || !game.players.has(playerId)) return ack(cb, { error: 'Yeniden bağlanılamadı.' });
    const p = game.players.get(playerId);
    p.connected = true;
    sockets.set(socket.id, { code, playerId });
    socket.join(`room:${code}`);
    ack(cb, { ok: true, code });
    game.pushStateTo(playerId);
    pushLobby(code);
    emitRoster(code);
  });

  // --- Oyunu başlat (host) ---
  socket.on('game:start', ({ rounds } = {}, cb) => {
    const game = currentGame();
    if (!game) return ack(cb, { error: 'Oyun yok.' });
    if (currentPlayerId() !== game.hostId) return ack(cb, { error: 'Sadece host başlatabilir.' });
    const r = game.start({ rounds });
    ack(cb, r);
  });

  // --- Eylemler ---
  socket.on('action:move', ({ room }, cb) => withGame(cb, (g, pid) => g.move(pid, room)));
  socket.on('action:investigate', ({ objId }, cb) => withGame(cb, (g, pid) => g.investigate(pid, objId)));
  socket.on('action:take', ({ objId }, cb) => withGame(cb, (g, pid) => g.takeObject(pid, objId)));
  socket.on('action:plant', ({ itemUid, clean }, cb) => withGame(cb, (g, pid) => g.plantItem(pid, itemUid, clean)));
  socket.on('action:give', ({ itemUid, targetId }, cb) => withGame(cb, (g, pid) => g.giveItem(pid, itemUid, targetId)));
  socket.on('action:announce', ({ message }, cb) => withGame(cb, (g, pid) => g.announce(pid, message)));
  socket.on('action:goto', ({ room }, cb) => withGame(cb, (g, pid) => g.goToAnnounced(pid, room)));
  socket.on('action:vote', ({ verdict, suspectId }, cb) => withGame(cb, (g, pid) => g.castVote(pid, verdict, suspectId)));
  socket.on('action:notebook', ({ text }, cb) => withGame(cb, (g, pid) => g.setNotebook(pid, text)));
  socket.on('action:busy', ({ busy }) => { const g = currentGame(); if (g) g.setBusy(currentPlayerId(), busy); });
  socket.on('action:skipPhase', (_, cb) => withGame(cb, (g, pid) => g.skipPhase(pid)));

  // --- Genişletilmiş sistemler ---
  socket.on('action:eavesdrop', ({ targetRoom }, cb) => withGame(cb, (g, pid) => g.toggleEavesdrop(pid, targetRoom)));
  socket.on('action:fillSlot', ({ slotId, text }, cb) => withGame(cb, (g, pid) => g.fillSlot(pid, slotId, text)));
  socket.on('action:jointInvite', (_, cb) => withGame(cb, (g, pid) => g.jointInvite(pid)));
  socket.on('action:jointAccept', (_, cb) => withGame(cb, (g, pid) => g.jointAccept(pid)));
  socket.on('action:phoneSend', ({ toOwnerId, text }, cb) => withGame(cb, (g, pid) => g.sendPhoneMessage(pid, toOwnerId, text)));
  socket.on('action:phoneDelete', ({ msgId }, cb) => withGame(cb, (g, pid) => g.deletePhoneMessage(pid, msgId)));
  socket.on('action:phoneSeize', ({ targetId }, cb) => withGame(cb, (g, pid) => g.seizePhone(pid, targetId)));
  socket.on('action:callStart', ({ toOwnerId }, cb) => withGame(cb, (g, pid) => g.startCall(pid, toOwnerId)));
  socket.on('action:callEnd', (_, cb) => withGame(cb, (g, pid) => g.endCall(pid)));
  socket.on('action:floorRequest', (_, cb) => withGame(cb, (g, pid) => g.requestFloor(pid)));
  socket.on('action:floorRelease', (_, cb) => withGame(cb, (g, pid) => g.releaseFloor(pid)));

  // --- Proximity sohbet ---
  socket.on('chat:send', ({ text }, cb) => withGame(cb, (g, pid) => g.sendChat(pid, text)));

  // --- WebRTC sinyalleşme (proximity sesli sohbet — Bölüm 8) ---
  // Sunucu yalnızca sinyal taşır; ses akışı P2P mesh, mesafe filtresi istemcide.
  socket.on('voice:ready', () => {
    const game = currentGame();
    const pid = currentPlayerId();
    if (!game || !pid) return;
    emitRoster(game.code);
  });
  socket.on('rtc:signal', ({ toPlayerId, signal }) => {
    const info = sockets.get(socket.id);
    if (!info) return;
    relayToPlayer(info.code, toPlayerId, 'rtc:signal', { fromPlayerId: info.playerId, signal });
  });

  function withGame(cb, fn) {
    const game = currentGame();
    const pid = currentPlayerId();
    if (!game || !pid) return ack(cb, { error: 'Oyun/oyuncu yok.' });
    const r = fn(game, pid);
    ack(cb, r);
  }

  // --- Bağlantı kopması ---
  socket.on('disconnect', () => {
    const info = sockets.get(socket.id);
    if (!info) return;
    const game = games.get(info.code);
    sockets.delete(socket.id);
    if (!game) return;
    // Aynı oyuncunun başka aktif soketi var mı?
    const stillConnected = [...sockets.values()].some(
      (s) => s.code === info.code && s.playerId === info.playerId
    );
    if (!stillConnected) {
      game.removePlayer(info.playerId);
      game.reassignHostIfNeeded();
      // Oda boşaldıysa temizle
      if ([...game.players.values()].every((p) => !p.connected) && game.phase === PHASE.LOBBY) {
        games.delete(info.code);
      } else {
        pushLobby(info.code);
        if (game.phase !== PHASE.LOBBY) game._pushState();
        emitRoster(info.code);
      }
    }
  });

  function pushLobby(code) {
    const game = games.get(code);
    if (!game || game.phase !== PHASE.LOBBY) return;
    game.players.forEach((p) => { if (p.connected) game.pushStateTo(p.id); });
  }
});

// ---------------------------------------------------------------------------
//  SUNUCUYU BAŞLAT + Hamachi IP ipucu yazdır
// ---------------------------------------------------------------------------
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n=============================================');
  console.log('  Şüpheli Ölüm — sunucu çalışıyor');
  console.log('=============================================');
  console.log(`  Yerel:      http://localhost:${PORT}`);
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        const isHamachi = a.address.startsWith('25.');
        console.log(`  ${isHamachi ? 'HAMACHI →' : 'LAN:     '}  http://${a.address}:${PORT}  (${name})`);
      }
    }
  }
  console.log('\n  Arkadaşların Hamachi (25.x.x.x) adresinle bağlanır.');
  console.log('=============================================\n');
});
