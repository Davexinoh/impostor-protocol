// server/walrus.js
// Walrus storage layer — session snapshots, player profiles, AI memory, match replay

const https = require('https');
const http = require('http');

const PUBLISHER = process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space';
const AGGREGATOR = process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';

/* ── LOW LEVEL HTTP ── */
function httpRequest(url, method, data) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
    req.end();
  });
}

/* ── STORE BLOB ── */
async function storeBlob(payload, epochs = 5) {
  try {
    const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const res = await httpRequest(
      `${PUBLISHER}/v1/store?epochs=${epochs}`,
      'PUT',
      json
    );
    if (res.status === 200 && res.data?.newlyCreated?.blobObject?.blobId) {
      return { ok: true, blobId: res.data.newlyCreated.blobObject.blobId };
    }
    if (res.status === 200 && res.data?.alreadyCertified?.blobId) {
      return { ok: true, blobId: res.data.alreadyCertified.blobId };
    }
    return { ok: false, error: `Unexpected response: ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ── FETCH BLOB ── */
async function fetchBlob(blobId) {
  try {
    const res = await httpRequest(`${AGGREGATOR}/v1/${blobId}`, 'GET');
    if (res.status === 200) return { ok: true, data: res.data };
    return { ok: false, error: `Status ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ═══════════════════════════════════════
   GAME SESSION SNAPSHOTS
   Written every 5s during live gameplay.
   Used for reconnect — fetch latest blob
   and resume from exact game state.
═══════════════════════════════════════ */
async function saveSessionSnapshot(roomCode, snapshot) {
  const payload = {
    type: 'session_snapshot',
    roomCode,
    snapshot,
    savedAt: Date.now(),
  };
  return storeBlob(payload, 3); // 3 epochs — short lived, just for reconnect
}

async function loadSessionSnapshot(blobId) {
  const res = await fetchBlob(blobId);
  if (!res.ok) return null;
  return res.data?.snapshot || null;
}

/* ═══════════════════════════════════════
   PLAYER PROFILE BLOBS
   Public: rep score, games played, win rates, achievements.
   Private analytics stored server-side only.
═══════════════════════════════════════ */
async function savePlayerProfile(walletAddr, profile) {
  const payload = {
    type: 'player_profile',
    wallet: walletAddr,
    profile,
    updatedAt: Date.now(),
  };
  return storeBlob(payload, 90); // ~3 months
}

function buildPlayerProfile(wallet, existingProfile, gameResult) {
  const base = existingProfile || {
    wallet,
    gamesPlayed: 0,
    crewWins: 0,
    impostorWins: 0,
    taskCompletionRate: 0,
    killCount: 0,
    correctVotes: 0,
    incorrectVotes: 0,
    reputation: 1000,
    achievements: [],
    lastGame: null,
  };

  base.gamesPlayed++;
  base.lastGame = Date.now();

  const { role, won, kills, tasks, correctVotes, incorrectVotes, repDelta } = gameResult;

  if (role === 'crewmate' && won) base.crewWins++;
  if (role === 'impostor' && won) base.impostorWins++;
  base.killCount += kills || 0;
  base.correctVotes += correctVotes || 0;
  base.incorrectVotes += incorrectVotes || 0;
  base.reputation = Math.max(0, base.reputation + (repDelta || 0));

  // task completion rate rolling average
  const taskRate = tasks / 6;
  base.taskCompletionRate = ((base.taskCompletionRate * (base.gamesPlayed - 1)) + taskRate) / base.gamesPlayed;

  return base;
}

/* ═══════════════════════════════════════
   AI AGENT MEMORY BLOBS
   Agents accumulate behavioral observations
   about specific wallet addresses over time.
   Stored per agent-ID, fetched at game start.
═══════════════════════════════════════ */
async function saveAgentMemory(agentId, memory) {
  const payload = {
    type: 'ai_agent_memory',
    agentId,
    memory,
    updatedAt: Date.now(),
  };
  return storeBlob(payload, 365);
}

async function loadAgentMemory(blobId) {
  const res = await fetchBlob(blobId);
  if (!res.ok) return null;
  return res.data?.memory || null;
}

function updateAgentMemory(existingMemory, walletAddr, observation) {
  const mem = existingMemory || { observations: {}, strategyWeights: { aggression: 0.5, deception: 0.5 } };
  if (!mem.observations[walletAddr]) mem.observations[walletAddr] = [];
  mem.observations[walletAddr].push({ ...observation, t: Date.now() });
  // keep last 20 observations per wallet
  if (mem.observations[walletAddr].length > 20) mem.observations[walletAddr].shift();
  return mem;
}

/* ═══════════════════════════════════════
   MATCH REPLAY ARCHIVE
   Full event timeline for every completed
   game. Permanent — never expires.
   This is the "why not a database?" answer.
═══════════════════════════════════════ */
async function saveMatchReplay(roomCode, replayData) {
  const payload = {
    type: 'match_replay',
    roomCode,
    replay: replayData,
    archivedAt: Date.now(),
  };
  return storeBlob(payload, 0); // 0 = store indefinitely on Walrus
}

function buildReplayData(room) {
  const players = [...room.players.values()].map(p => ({
    id: p.id, wallet: p.wallet, name: p.name, color: p.color,
    role: p.role, // safe to include in replay after game ends
    finalAlive: p.alive,
    kills: p.killCount,
    tasks: p.tasksCompleted,
    correctVotes: p.votedCorrectly,
    incorrectVotes: p.votedIncorrectly,
  }));

  return {
    roomCode: room.code,
    mode: room.mode,
    startedAt: room.startedAt,
    endedAt: room.endedAt || Date.now(),
    duration: Math.floor(((room.endedAt || Date.now()) - room.startedAt) / 1000),
    players,
    events: room.replayEvents,
    finalState: {
      tasksDone: room.tasksDone,
      deadBodies: room.deadBodies,
    },
  };
}

module.exports = {
  storeBlob, fetchBlob,
  saveSessionSnapshot, loadSessionSnapshot,
  savePlayerProfile, buildPlayerProfile,
  saveAgentMemory, loadAgentMemory, updateAgentMemory,
  saveMatchReplay, buildReplayData,
};
