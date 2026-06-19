// server/gameState.js
// Authoritative game state — single source of truth for all rooms

const TICK_RATE = 50; // ms — 20 ticks per second
const KILL_COOLDOWN = 25; // seconds
const TASK_COUNT = 6;
const AI_COLORS = ['#ef7d0e', '#6b2fbb', '#38fedc', '#50ef39'];

const TASKS_DEF = [
  { id: 'wiring',  name: 'Fix Wiring',          room: 'ELECTRICAL', rx: 0.70, ry: 0.58 },
  { id: 'swipe',   name: 'Swipe Card',           room: 'CAFETERIA',  rx: 0.14, ry: 0.20 },
  { id: 'chart',   name: 'Chart Course',         room: 'NAVIGATION', rx: 0.87, ry: 0.18 },
  { id: 'upload',  name: 'Upload Data',          room: 'COMMS',      rx: 0.68, ry: 0.84 },
  { id: 'dial',    name: 'Calibrate Distributor',room: 'O2',         rx: 0.64, ry: 0.18 },
  { id: 'reactor', name: 'Start Reactor',        room: 'REACTOR',    rx: 0.42, ry: 0.60 },
];

const VENTS = [
  { x: 0.20, y: 0.25 }, { x: 0.54, y: 0.60 },
  { x: 0.42, y: 0.70 }, { x: 0.72, y: 0.30 },
];

// All active rooms: Map<roomCode, RoomState>
const rooms = new Map();

/* ── ROOM CREATION ── */
function createRoom(roomCode, hostWallet, mode = 'casual', stake = 0) {
  const room = {
    code: roomCode,
    mode,
    stake,
    phase: 'lobby',       // lobby | game | meeting | ended
    players: new Map(),   // socketId → player
    deadBodies: [],
    meetingCaller: null,
    votes: new Map(),     // voterId → targetId
    meetingTimer: null,
    tasks: TASKS_DEF.map(t => ({ ...t, done: false })),
    tasksDone: 0,
    sabotage: null,
    saboTimer: null,
    killCooldowns: new Map(), // socketId → seconds remaining
    startedAt: null,
    endedAt: null,
    walrusBlobId: null,     // set after Walrus snapshot
    replayEvents: [],       // full event log for Walrus replay
    tickInterval: null,
    emergencyUsed: new Set(),
    hostSocketId: null,
  };
  rooms.set(roomCode, room);
  return room;
}

/* ── PLAYER JOIN ── */
function addPlayer(room, socketId, wallet, name, color, isAI = false) {
  const player = {
    id: socketId,
    wallet,
    name,
    color,
    x: 0.1 + Math.random() * 0.8,
    y: 0.2 + Math.random() * 0.6,
    alive: true,
    role: 'crewmate',     // assigned at game start
    isAI,
    ready: isAI,          // AI is always ready
    tasksCompleted: [],
    killCount: 0,
    votedCorrectly: 0,
    votedIncorrectly: 0,
  };
  room.players.set(socketId, player);
  return player;
}

/* ── FILL LOBBY WITH AI ── */
function fillWithAI(room, count = 1) {
  for (let i = 0; i < count; i++) {
    const aiId = `ai_${Date.now()}_${i}`;
    const color = AI_COLORS[i % AI_COLORS.length];
    addPlayer(room, aiId, `0xAI${aiId.slice(-6)}`, `AI-${Math.floor(Math.random()*9000+1000)}`, color, true);
  }
}

/* ── ROLE ASSIGNMENT ── */
function assignRoles(room, impostorCount = 1) {
  const playerList = [...room.players.values()];
  const shuffled = playerList.sort(() => Math.random() - 0.5);
  shuffled.forEach((p, i) => {
    p.role = i < impostorCount ? 'impostor' : 'crewmate';
  });
  // Reset kill cooldowns for impostors
  shuffled.filter(p => p.role === 'impostor').forEach(p => {
    room.killCooldowns.set(p.id, 0); // ready immediately at start
  });
}

/* ── MOVEMENT UPDATE (from client) ── */
function updatePosition(room, socketId, x, y) {
  const player = room.players.get(socketId);
  if (!player || !player.alive || room.phase !== 'game') return;
  // clamp to map bounds
  player.x = Math.max(0.01, Math.min(0.99, x));
  player.y = Math.max(0.02, Math.min(0.98, y));
}

/* ── KILL ── */
function attemptKill(room, killerSocketId, victimSocketId) {
  if (room.phase !== 'game') return { ok: false, reason: 'not in game' };
  const killer = room.players.get(killerSocketId);
  const victim = room.players.get(victimSocketId);
  if (!killer || !victim) return { ok: false, reason: 'player not found' };
  if (killer.role !== 'impostor') return { ok: false, reason: 'not impostor' };
  if (!victim.alive) return { ok: false, reason: 'already dead' };
  if ((room.killCooldowns.get(killerSocketId) || 0) > 0) return { ok: false, reason: 'cooldown active' };

  const dist = Math.hypot(killer.x - victim.x, killer.y - victim.y);
  if (dist > 0.06) return { ok: false, reason: 'too far' };

  victim.alive = false;
  killer.killCount++;
  room.killCooldowns.set(killerSocketId, KILL_COOLDOWN);
  room.deadBodies.push({ x: victim.x, y: victim.y, name: victim.name, col: victim.color, victimId: victimSocketId });

  logEvent(room, 'kill', { killer: killer.name, victim: victim.name, x: victim.x, y: victim.y });
  return { ok: true, victim: victim.name };
}

/* ── TASK COMPLETE ── */
function completeTask(room, socketId, taskId) {
  if (room.phase !== 'game') return { ok: false };
  const player = room.players.get(socketId);
  if (!player || !player.alive || player.role === 'impostor') return { ok: false };
  const task = room.tasks.find(t => t.id === taskId && !t.done);
  if (!task) return { ok: false };

  task.done = true;
  room.tasksDone++;
  player.tasksCompleted.push(taskId);
  logEvent(room, 'task', { player: player.name, task: task.name });

  const allDone = room.tasksDone >= room.tasks.length;
  return { ok: true, tasksDone: room.tasksDone, total: room.tasks.length, win: allDone };
}

/* ── REPORT BODY ── */
function reportBody(room, reporterSocketId, bodyVictimId) {
  if (room.phase !== 'game') return { ok: false };
  const reporter = room.players.get(reporterSocketId);
  if (!reporter || !reporter.alive) return { ok: false };
  const body = room.deadBodies.find(b => b.victimId === bodyVictimId);
  if (!body) return { ok: false };

  logEvent(room, 'report', { reporter: reporter.name, victim: body.name });
  return { ok: true, reporter: reporter.name, victim: body.name };
}

/* ── EMERGENCY MEETING ── */
function callEmergency(room, callerSocketId) {
  if (room.phase !== 'game') return { ok: false };
  if (room.emergencyUsed.has(callerSocketId)) return { ok: false, reason: 'already used' };
  const caller = room.players.get(callerSocketId);
  if (!caller || !caller.alive) return { ok: false };

  room.emergencyUsed.add(callerSocketId);
  logEvent(room, 'emergency', { caller: caller.name });
  return { ok: true, caller: caller.name };
}

/* ── VOTE ── */
function castVote(room, voterSocketId, targetSocketId) {
  if (room.phase !== 'meeting') return { ok: false };
  if (room.votes.has(voterSocketId)) return { ok: false, reason: 'already voted' };
  room.votes.set(voterSocketId, targetSocketId);

  const alivePlayers = [...room.players.values()].filter(p => p.alive);
  const allVoted = alivePlayers.every(p => room.votes.has(p.id));

  logEvent(room, 'vote', {
    voter: room.players.get(voterSocketId)?.name,
    target: targetSocketId === 'skip' ? 'skip' : room.players.get(targetSocketId)?.name,
  });

  return { ok: true, allVoted, voteCount: room.votes.size, total: alivePlayers.length };
}

/* ── RESOLVE VOTES ── */
function resolveVotes(room) {
  const tally = new Map();
  room.votes.forEach((target) => {
    if (target === 'skip') return;
    tally.set(target, (tally.get(target) || 0) + 1);
  });

  let maxVotes = 0, ejected = null;
  tally.forEach((count, targetId) => {
    if (count > maxVotes) { maxVotes = count; ejected = targetId; }
    else if (count === maxVotes) { ejected = null; } // tie = skip
  });

  let ejectedPlayer = null;
  if (ejected) {
    ejectedPlayer = room.players.get(ejected);
    if (ejectedPlayer) {
      ejectedPlayer.alive = false;
      // track voting accuracy
      room.votes.forEach((target, voterId) => {
        const voter = room.players.get(voterId);
        if (!voter) return;
        if (target === ejected) {
          ejectedPlayer.role === 'impostor' ? voter.votedCorrectly++ : voter.votedIncorrectly++;
        }
      });
      logEvent(room, 'eject', { ejected: ejectedPlayer.name, wasImpostor: ejectedPlayer.role === 'impostor' });
    }
  }

  room.votes.clear();
  return {
    ejected: ejectedPlayer ? { id: ejectedPlayer.id, name: ejectedPlayer.name, color: ejectedPlayer.color, wasImpostor: ejectedPlayer.role === 'impostor' } : null,
  };
}

/* ── WIN CHECK ── */
function checkWin(room) {
  const alive = [...room.players.values()].filter(p => p.alive);
  const aliveImpostors = alive.filter(p => p.role === 'impostor').length;
  const aliveCrew = alive.filter(p => p.role === 'crewmate').length;

  if (aliveImpostors === 0) return { win: true, side: 'crew', reason: 'All impostors ejected' };
  if (aliveImpostors >= aliveCrew) return { win: true, side: 'impostor', reason: 'Impostors outnumber crew' };
  if (room.tasksDone >= room.tasks.length) return { win: true, side: 'crew', reason: 'All tasks completed' };
  return { win: false };
}

/* ── AI TICK ── */
function tickAI(room) {
  if (room.phase !== 'game') return;
  const t = Date.now() / 1000;

  room.players.forEach((p) => {
    if (!p.isAI || !p.alive) return;

    // simple wander
    p.x = Math.max(0.05, Math.min(0.95, p.x + (Math.random() - 0.5) * 0.006));
    p.y = Math.max(0.05, Math.min(0.95, p.y + (Math.random() - 0.5) * 0.006));

    // AI crewmate: complete a random undone task if near it
    if (p.role === 'crewmate') {
      const undone = room.tasks.filter(t => !t.done);
      undone.forEach(task => {
        const d = Math.hypot(p.x - task.rx, p.y - task.ry);
        if (d < 0.04 && Math.random() < 0.02) {
          completeTask(room, p.id, task.id);
        }
      });
    }

    // AI impostor: attempt kill if near crewmate and cooldown ready
    if (p.role === 'impostor' && (room.killCooldowns.get(p.id) || 0) === 0) {
      room.players.forEach((target) => {
        if (target.isAI || !target.alive || target.role === 'impostor') return;
        const d = Math.hypot(p.x - target.x, p.y - target.y);
        if (d < 0.05 && Math.random() < 0.03) {
          attemptKill(room, p.id, target.id);
        }
      });
    }
  });
}

/* ── KILL COOLDOWN TICK ── */
function tickCooldowns(room) {
  room.killCooldowns.forEach((cd, socketId) => {
    if (cd > 0) room.killCooldowns.set(socketId, cd - (TICK_RATE / 1000));
  });
}

/* ── SNAPSHOT FOR WALRUS ── */
function buildSnapshot(room) {
  return {
    roomCode: room.code,
    phase: room.phase,
    timestamp: Date.now(),
    players: [...room.players.values()].map(p => ({
      id: p.id, wallet: p.wallet, name: p.name, color: p.color,
      x: p.x, y: p.y, alive: p.alive, role: p.role,
      tasksCompleted: p.tasksCompleted,
    })),
    tasks: room.tasks.map(t => ({ id: t.id, done: t.done })),
    tasksDone: room.tasksDone,
    deadBodies: room.deadBodies,
  };
}

/* ── EVENT LOG ── */
function logEvent(room, type, data) {
  room.replayEvents.push({ t: Date.now(), type, ...data });
}

/* ── SERIALIZE STATE FOR BROADCAST ── */
function serializeRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color,
      x: p.x, y: p.y, alive: p.alive,
      ready: p.ready, isAI: p.isAI,
      // never broadcast role to avoid cheating — each client gets their own role
    })),
    tasks: room.tasks.map(t => ({ id: t.id, done: t.done, rx: t.rx, ry: t.ry })),
    tasksDone: room.tasksDone,
    deadBodies: room.deadBodies,
    killCooldowns: Object.fromEntries(room.killCooldowns),
  };
}

module.exports = {
  rooms, createRoom, addPlayer, fillWithAI, assignRoles,
  updatePosition, attemptKill, completeTask, reportBody,
  callEmergency, castVote, resolveVotes, checkWin,
  tickAI, tickCooldowns, buildSnapshot, serializeRoom, logEvent,
  TICK_RATE, KILL_COOLDOWN,
};
