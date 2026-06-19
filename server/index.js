// server/index.js
// Impostor Protocol — WebSocket game server
// Socket.io + Express, deployed on Render

require('dotenv').config();
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');

const GS = require('./gameState');
const WL = require('./walrus');
const SUI = require('./sui');

const PORT       = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || '*';

/* ══════════════════════════════
   HTTP + SOCKET.IO SETUP
══════════════════════════════ */
const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
  pingTimeout: 30000,
  pingInterval: 10000,
});

/* ══════════════════════════════
   REST ENDPOINTS
══════════════════════════════ */
app.get('/health', (_, res) => res.json({ ok: true, rooms: GS.rooms.size }));

// Fetch reputation for a wallet
app.get('/rep/:wallet', async (req, res) => {
  const result = await SUI.getReputation(req.params.wallet);
  res.json(result);
});

// Fetch a Walrus replay by blob ID
app.get('/replay/:blobId', async (req, res) => {
  const { fetchBlob } = require('./walrus');
  const result = await fetchBlob(req.params.blobId);
  res.json(result);
});

// Room info (for lobby page to poll)
app.get('/room/:code', (req, res) => {
  const room = GS.rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    code: room.code, phase: room.phase, mode: room.mode,
    playerCount: room.players.size,
    walrusBlobId: room.walrusBlobId,
  });
});

/* ══════════════════════════════
   ROOM CODE GENERATOR
══════════════════════════════ */
function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code + '-' + Math.floor(1000 + Math.random() * 9000);
}

/* ══════════════════════════════
   WALRUS SNAPSHOT INTERVAL
══════════════════════════════ */
async function startSnapshotInterval(room) {
  if (room._snapshotInterval) clearInterval(room._snapshotInterval);
  room._snapshotInterval = setInterval(async () => {
    if (room.phase === 'game') {
      const snapshot = GS.buildSnapshot(room);
      const result = await WL.saveSessionSnapshot(room.code, snapshot);
      if (result.ok) room.walrusBlobId = result.blobId;
    }
  }, 5000);
}

/* ══════════════════════════════
   MEETING PHASE MANAGER
══════════════════════════════ */
function startMeeting(room, reason, io) {
  if (room.meetingTimer) clearInterval(room.meetingTimer);
  room.phase = 'meeting';
  room.votes = new Map();
  let t = 30;

  const state = GS.serializeRoom(room);
  io.to(room.code).emit('meeting:start', { reason, state, timer: t });

  room.meetingTimer = setInterval(() => {
    t--;
    io.to(room.code).emit('meeting:tick', { timer: t });
    if (t <= 0) endMeeting(room, io);
  }, 1000);
}

function endMeeting(room, io) {
  clearInterval(room.meetingTimer);
  room.meetingTimer = null;
  const { ejected } = GS.resolveVotes(room);
  io.to(room.code).emit('meeting:result', { ejected });

  setTimeout(() => {
    room.phase = 'game';
    const winCheck = GS.checkWin(room);
    if (winCheck.win) return endGame(room, io, winCheck.side, winCheck.reason);
    io.to(room.code).emit('game:resume', GS.serializeRoom(room));
  }, 4000);
}

/* ══════════════════════════════
   GAME END
══════════════════════════════ */
async function endGame(room, io, winningSide, reason) {
  if (room.phase === 'ended') return;
  room.phase = 'ended';
  room.endedAt = Date.now();

  if (room._snapshotInterval) clearInterval(room._snapshotInterval);
  if (room.tickInterval) clearInterval(room.tickInterval);
  if (room.meetingTimer) clearInterval(room.meetingTimer);

  const players = [...room.players.values()];
  const duration = Math.floor((room.endedAt - room.startedAt) / 1000);

  // Build per-player results
  const playerResults = players.map(p => {
    const won = (winningSide === 'crew' && p.role === 'crewmate') ||
                (winningSide === 'impostor' && p.role === 'impostor');
    const gameResult = {
      role: p.role, won, survived: p.alive,
      allTasksDone: p.role === 'crewmate' && p.tasksCompleted.length >= 6,
      kills: p.killCount, tasks: p.tasksCompleted.length,
      correctVotes: p.votedCorrectly, incorrectVotes: p.votedIncorrectly,
      neverVotedAgainst: true, // simplified for v1
    };
    const repDelta = SUI.calcRepDelta(gameResult);
    gameResult.repDelta = repDelta;

    const achievements = SUI.checkAchievements(p, gameResult);
    return { player: p, gameResult, repDelta, achievements };
  });

  // Broadcast end to all clients with their personal results
  players.forEach(p => {
    const socket = io.sockets.sockets.get(p.id);
    if (!socket) return;
    const myResult = playerResults.find(r => r.player.id === p.id);
    socket.emit('game:end', {
      winningSide, reason, duration,
      myRole: p.role, myResult: myResult?.gameResult,
      repDelta: myResult?.repDelta || 0,
      achievements: myResult?.achievements || [],
    });
  });

  // ── Async onchain + Walrus operations ──
  // Run in background — don't block the end screen
  setImmediate(async () => {
    // 1. Save match replay to Walrus
    const replayData = WL.buildReplayData(room);
    const replayResult = await WL.saveMatchReplay(room.code, replayData);
    if (replayResult.ok) {
      console.log(`[walrus] Replay saved: ${replayResult.blobId}`);
      io.to(room.code).emit('replay:saved', { blobId: replayResult.blobId });
    }

    // 2. Register game onchain
    await SUI.registerGameOnchain(room.code, players, winningSide, duration);

    // 3. Update rep + mint achievements per player
    for (const { player, gameResult, repDelta, achievements } of playerResults) {
      if (player.isAI || !player.wallet) continue;

      await SUI.updateReputation(player.wallet, repDelta);

      for (const achKey of achievements) {
        const result = await SUI.mintAchievement(player.wallet, achKey);
        if (result.ok) {
          const sock = io.sockets.sockets.get(player.id);
          if (sock) sock.emit('achievement:minted', { achievement: SUI.ACHIEVEMENTS[achKey], nftId: result.nftId });
        }
      }

      // 4. Distribute staking winnings (ranked mode)
      if (room.mode === 'ranked' && (
        (winningSide === 'crew'     && player.role === 'crewmate') ||
        (winningSide === 'impostor' && player.role === 'impostor')
      )) {
        const winnerWallets = players.filter(p =>
          (winningSide === 'crew' && p.role === 'crewmate') ||
          (winningSide === 'impostor' && p.role === 'impostor')
        ).map(p => p.wallet);
        await SUI.distributeWinnings(room.code, winnerWallets, winningSide);
      }
    }

    // 5. Clean up room after 60s
    setTimeout(() => GS.rooms.delete(room.code), 60000);
  });
}

/* ══════════════════════════════
   GAME TICK LOOP
   Runs every 50ms (20 Hz).
   Broadcasts authoritative state.
══════════════════════════════ */
function startGameLoop(room, io) {
  if (room.tickInterval) clearInterval(room.tickInterval);
  room.tickInterval = setInterval(() => {
    if (room.phase !== 'game') return;
    GS.tickAI(room);
    GS.tickCooldowns(room);
    io.to(room.code).emit('game:tick', GS.serializeRoom(room));
  }, GS.TICK_RATE);
}

/* ══════════════════════════════
   SOCKET.IO EVENT HANDLERS
══════════════════════════════ */
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  /* ── CREATE ROOM ── */
  socket.on('room:create', async ({ wallet, name, color, mode, stake }) => {
    const code = genRoomCode();
    const room = GS.createRoom(code, wallet, mode, stake);
    room.hostSocketId = socket.id;

    const player = GS.addPlayer(room, socket.id, wallet, name, color);
    socket.join(code);
    socket.data = { roomCode: code, wallet };

    // If ranked, create staking pool onchain
    if (mode === 'ranked' && stake > 0) {
      const stakeResult = await SUI.createStakingPool(code, stake);
      console.log('[sui] staking pool:', stakeResult.ok ? stakeResult.digest : stakeResult.error);
    }

    socket.emit('room:created', { code, player: { id: socket.id, name, color, wallet }, room: GS.serializeRoom(room) });
    console.log(`[room] created: ${code} by ${name}`);
  });

  /* ── JOIN ROOM ── */
  socket.on('room:join', ({ code, wallet, name, color }) => {
    const room = GS.rooms.get(code.toUpperCase());
    if (!room) return socket.emit('error', { msg: 'Room not found' });
    if (room.phase !== 'lobby') return socket.emit('error', { msg: 'Game already started' });
    if (room.players.size >= 10) return socket.emit('error', { msg: 'Room is full' });

    const player = GS.addPlayer(room, socket.id, wallet, name, color);
    socket.join(code.toUpperCase());
    socket.data = { roomCode: code.toUpperCase(), wallet };

    socket.emit('room:joined', { player: { id: socket.id, name, color, wallet }, room: GS.serializeRoom(room) });
    socket.to(code.toUpperCase()).emit('room:playerJoined', { player: { id: socket.id, name, color }, room: GS.serializeRoom(room) });
    console.log(`[room] ${name} joined ${code}`);
  });

  /* ── RECONNECT ── */
  socket.on('room:reconnect', async ({ code, wallet, blobId }) => {
    const room = GS.rooms.get(code.toUpperCase());
    if (!room) return socket.emit('error', { msg: 'Room expired or not found' });

    // Find the original player by wallet
    let originalPlayer = [...room.players.values()].find(p => p.wallet === wallet);
    if (originalPlayer) {
      // Re-map the old socket ID to the new one
      room.players.delete(originalPlayer.id);
      originalPlayer.id = socket.id;
      room.players.set(socket.id, originalPlayer);
    }

    socket.join(code.toUpperCase());
    socket.data = { roomCode: code.toUpperCase(), wallet };

    // Optionally restore from Walrus snapshot
    let snapshot = null;
    if (blobId) {
      snapshot = await WL.loadSessionSnapshot(blobId);
      console.log(`[walrus] Reconnect snapshot restored: ${blobId}`);
    }

    socket.emit('room:reconnected', {
      player: originalPlayer ? { id: socket.id, role: originalPlayer.role } : null,
      room: GS.serializeRoom(room),
      snapshot,
    });
    console.log(`[room] ${wallet} reconnected to ${code}`);
  });

  /* ── READY UP ── */
  socket.on('player:ready', () => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) player.ready = true;
    io.to(roomCode).emit('room:update', GS.serializeRoom(room));
  });

  /* ── START GAME (host only) ── */
  socket.on('game:start', ({ impostorCount = 1 }) => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return socket.emit('error', { msg: 'Not host' });
    if (room.players.size < 4) return socket.emit('error', { msg: 'Need at least 4 players' });

    // Fill remaining slots with AI
    const realCount = [...room.players.values()].filter(p => !p.isAI).length;
    if (realCount < 4) GS.fillWithAI(room, 4 - realCount);

    GS.assignRoles(room, impostorCount);
    room.phase = 'game';
    room.startedAt = Date.now();

    // Send each player THEIR role privately
    room.players.forEach((player, socketId) => {
      const sock = io.sockets.sockets.get(socketId);
      if (!sock) return;
      sock.emit('game:roleAssigned', { role: player.role, color: player.color });
    });

    // Broadcast game start state
    io.to(roomCode).emit('game:started', GS.serializeRoom(room));

    // Start tick loop and Walrus snapshots
    startGameLoop(room, io);
    startSnapshotInterval(room);
    console.log(`[game] started: ${roomCode} | ${room.players.size} players`);
  });

  /* ── PLAYER MOVEMENT ── */
  socket.on('player:move', ({ x, y }) => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room) return;
    GS.updatePosition(room, socket.id, x, y);
    // Position is broadcast via game:tick — no individual emit needed
  });

  /* ── KILL ── */
  socket.on('game:kill', ({ targetId }) => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room) return;
    const result = GS.attemptKill(room, socket.id, targetId);
    if (result.ok) {
      io.to(roomCode).emit('game:killed', { victim: result.victim, body: room.deadBodies.at(-1) });
      socket.emit('game:killCooldownStart', { cooldown: GS.KILL_COOLDOWN });
    } else {
      socket.emit('error', { msg: result.reason });
    }
  });

  /* ── TASK COMPLETE ── */
  socket.on('game:taskComplete', ({ taskId }) => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room) return;
    const result = GS.completeTask(room, socket.id, taskId);
    if (result.ok) {
      io.to(roomCode).emit('game:taskUpdate', { tasksDone: result.tasksDone, total: result.total });
      if (result.win) endGame(room, io, 'crew', 'All tasks completed');
    }
  });

  /* ── REPORT BODY ── */
  socket.on('game:report', ({ bodyVictimId, reason }) => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room) return;
    const result = GS.reportBody(room, socket.id, bodyVictimId);
    if (result.ok) startMeeting(room, `${result.reporter} reported ${result.victim}'s body`, io);
    else socket.emit('error', { msg: 'Cannot report' });
  });

  /* ── EMERGENCY MEETING ── */
  socket.on('game:emergency', () => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room) return;
    const result = GS.callEmergency(room, socket.id);
    if (result.ok) startMeeting(room, `Emergency meeting called by ${result.caller}`, io);
    else socket.emit('error', { msg: result.reason || 'Cannot call emergency' });
  });

  /* ── VENT ── */
  socket.on('game:vent', () => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || player.role !== 'impostor' || !player.alive) return;
    // Teleport to random other vent
    const VENTS = [{ x:.20,y:.25},{x:.54,y:.60},{x:.42,y:.70},{x:.72,y:.30}];
    const others = VENTS.filter(v => Math.hypot(player.x-v.x, player.y-v.y) > 0.06);
    if (others.length) {
      const dest = others[Math.floor(Math.random() * others.length)];
      player.x = dest.x; player.y = dest.y;
      socket.emit('game:vented', { x: dest.x, y: dest.y });
    }
  });

  /* ── MEETING CHAT ── */
  socket.on('meeting:chat', ({ text }) => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room || room.phase !== 'meeting') return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;
    const msg = { name: player.name, color: player.color, text: text.slice(0, 120) };
    GS.logEvent(room, 'chat', msg);
    io.to(roomCode).emit('meeting:message', msg);
  });

  /* ── CAST VOTE ── */
  socket.on('meeting:vote', ({ targetId }) => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room) return;
    const result = GS.castVote(room, socket.id, targetId);
    if (result.ok) {
      io.to(roomCode).emit('meeting:votecast', { voteCount: result.voteCount, total: result.total });
      if (result.allVoted) endMeeting(room, io);
    }
  });

  /* ── LOBBY CHAT ── */
  socket.on('lobby:chat', ({ text }) => {
    const { roomCode } = socket.data || {};
    const room = GS.rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    const msg = { name: player.name, color: player.color, text: text.slice(0, 120) };
    io.to(roomCode).emit('lobby:message', msg);
  });

  /* ── DISCONNECT ── */
  socket.on('disconnect', () => {
    const { roomCode, wallet } = socket.data || {};
    if (!roomCode) return;
    const room = GS.rooms.get(roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (player) {
      console.log(`[socket] disconnected: ${player.name} from ${roomCode}`);
      // Give 90s reconnect window before marking as dead
      player._disconnectTimer = setTimeout(() => {
        if (!player.alive) return;
        player.alive = false;
        // Reputation penalty for ragequit during game
        if (room.phase === 'game') {
          SUI.updateReputation(player.wallet, -50).catch(console.error);
        }
        io.to(roomCode).emit('player:disconnected', { name: player.name, id: socket.id });
        const winCheck = GS.checkWin(room);
        if (winCheck.win) endGame(room, io, winCheck.side, winCheck.reason);
      }, 90000);

      io.to(roomCode).emit('player:disconnecting', { name: player.name, countdown: 90 });

      // If host disconnected during lobby, promote next player
      if (room.phase === 'lobby' && socket.id === room.hostSocketId) {
        const nextPlayer = [...room.players.values()].find(p => p.id !== socket.id && !p.isAI);
        if (nextPlayer) {
          room.hostSocketId = nextPlayer.id;
          io.to(nextPlayer.id).emit('room:promoted', { msg: 'You are now the host' });
        }
      }
    }
  });
});

/* ══════════════════════════════
   START SERVER
══════════════════════════════ */
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   IMPOSTOR PROTOCOL — Game Server   ║
  ║   Port: ${PORT}  Network: ${process.env.SUI_NETWORK || 'testnet'}         ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = { app, io, server };
