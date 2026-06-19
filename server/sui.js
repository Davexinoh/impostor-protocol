// server/sui.js
// Sui Move contract interactions
// Reputation updates, staking pool, achievement NFT minting, game registry

const { SuiClient, getFullnodeUrl } = require('@mysten/sui.js/client');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { fromB64 } = require('@mysten/sui.js/utils');

const NETWORK = process.env.SUI_NETWORK || 'testnet';
const RPC_URL = process.env.SUI_RPC_URL || getFullnodeUrl(NETWORK);

const client = new SuiClient({ url: RPC_URL });

// Deployer keypair (used for server-side contract calls)
function getKeypair() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) throw new Error('DEPLOYER_PRIVATE_KEY not set in .env');
  return Ed25519Keypair.fromSecretKey(fromB64(privateKey));
}

// Package IDs from .env (set after deployment)
const PACKAGES = {
  gameRegistry:    process.env.GAME_REGISTRY_PACKAGE    || '0x0',
  reputationStore: process.env.REPUTATION_STORE_PACKAGE || '0x0',
  stakingPool:     process.env.STAKING_POOL_PACKAGE     || '0x0',
  achievementNFT:  process.env.ACHIEVEMENT_NFT_PACKAGE  || '0x0',
};

/* ── REPUTATION DELTA CALCULATION ── */
function calcRepDelta(gameResult) {
  const { role, won, survived, allTasksDone, wasEjectedInnocent, ragequit, impostorNeverSuspected, correctVotes, incorrectVotes } = gameResult;
  let delta = 0;

  if (ragequit)             delta -= 50;
  if (wasEjectedInnocent)   delta -= 10;
  delta += (correctVotes   || 0) * 25;
  delta -= (incorrectVotes || 0) * 15;

  if (role === 'crewmate' && survived && allTasksDone) delta += 30;
  if (role === 'impostor' && won && impostorNeverSuspected) delta += 50;

  return delta;
}

/* ═══════════════════════════════════════
   GAME REGISTRY CONTRACT
   Records each game session onchain.
   Immutable log — every completed game,
   players, roles, winner, duration.
═══════════════════════════════════════ */
async function registerGameOnchain(roomCode, players, winningSide, duration) {
  if (PACKAGES.gameRegistry === '0x0') {
    console.warn('[sui] GameRegistry package not deployed — skipping onchain registration');
    return { ok: false, reason: 'package not deployed' };
  }
  try {
    const keypair = getKeypair();
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${PACKAGES.gameRegistry}::game_registry::register_game`,
      arguments: [
        tx.pure(roomCode),
        tx.pure(players.map(p => p.wallet)),
        tx.pure(players.map(p => p.role === 'impostor' ? 1 : 0)),
        tx.pure(winningSide === 'crew' ? 0 : 1),
        tx.pure(duration),
        tx.pure(Math.floor(Date.now() / 1000)),
      ],
    });
    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair, transactionBlock: tx,
      options: { showEffects: true },
    });
    return { ok: true, digest: result.digest };
  } catch (err) {
    console.error('[sui] registerGame error:', err.message);
    return { ok: false, error: err.message };
  }
}

/* ═══════════════════════════════════════
   REPUTATION CONTRACT
   Per-wallet rep score stored onchain.
   Updated at end of every game.
═══════════════════════════════════════ */
async function updateReputation(walletAddr, repDelta) {
  if (PACKAGES.reputationStore === '0x0') {
    console.warn('[sui] ReputationStore package not deployed — skipping rep update');
    return { ok: false, reason: 'package not deployed' };
  }
  try {
    const keypair = getKeypair();
    const tx = new TransactionBlock();
    const isPositive = repDelta >= 0;
    tx.moveCall({
      target: `${PACKAGES.reputationStore}::reputation::update_score`,
      arguments: [
        tx.pure(walletAddr),
        tx.pure(Math.abs(repDelta)),
        tx.pure(isPositive),
      ],
    });
    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair, transactionBlock: tx,
      options: { showEffects: true },
    });
    return { ok: true, digest: result.digest };
  } catch (err) {
    console.error('[sui] updateReputation error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function getReputation(walletAddr) {
  if (PACKAGES.reputationStore === '0x0') return { ok: false, score: 1000 };
  try {
    const result = await client.devInspectTransactionBlock({
      transactionBlock: (() => {
        const tx = new TransactionBlock();
        tx.moveCall({
          target: `${PACKAGES.reputationStore}::reputation::get_score`,
          arguments: [tx.pure(walletAddr)],
        });
        return tx;
      })(),
      sender: walletAddr,
    });
    const score = result?.results?.[0]?.returnValues?.[0]?.[0];
    return { ok: true, score: score ? Number(score) : 1000 };
  } catch (err) {
    return { ok: false, score: 1000 };
  }
}

/* ═══════════════════════════════════════
   STAKING POOL CONTRACT
   Holds SUI stakes for ranked games.
   Distributes winnings on game end.
═══════════════════════════════════════ */
async function createStakingPool(roomCode, stakeAmount) {
  if (PACKAGES.stakingPool === '0x0') {
    console.warn('[sui] StakingPool package not deployed');
    return { ok: false, reason: 'package not deployed' };
  }
  try {
    const keypair = getKeypair();
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${PACKAGES.stakingPool}::staking::create_pool`,
      arguments: [tx.pure(roomCode), tx.pure(stakeAmount)],
    });
    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair, transactionBlock: tx,
      options: { showEffects: true },
    });
    return { ok: true, digest: result.digest };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function distributeWinnings(roomCode, winnerWallets, winningSide) {
  if (PACKAGES.stakingPool === '0x0') return { ok: false };
  try {
    const keypair = getKeypair();
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${PACKAGES.stakingPool}::staking::distribute`,
      arguments: [
        tx.pure(roomCode),
        tx.pure(winnerWallets),
        tx.pure(winningSide === 'crew' ? 0 : 1),
      ],
    });
    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair, transactionBlock: tx,
      options: { showEffects: true },
    });
    return { ok: true, digest: result.digest };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ═══════════════════════════════════════
   ACHIEVEMENT NFT CONTRACT
   Minted on specific milestone events.
   Perfect Crewmate, Ghost Protocol,
   Clutch Fix, Sus Lord.
═══════════════════════════════════════ */
const ACHIEVEMENTS = {
  PERFECT_CREWMATE:     { id: 0, name: 'Perfect Crewmate',  desc: 'Complete all tasks, never suspected, correct vote' },
  GHOST_PROTOCOL:       { id: 1, name: 'Ghost Protocol',     desc: 'Win as impostor without a single vote against you' },
  CLUTCH_FIX:           { id: 2, name: 'Clutch Fix',         desc: 'Fix reactor/O2 alone with under 5 seconds remaining' },
  SUS_LORD:             { id: 3, name: 'Sus Lord',           desc: 'Ejected incorrectly 10 times — crew is always wrong about you' },
};

async function mintAchievement(walletAddr, achievementKey) {
  const achievement = ACHIEVEMENTS[achievementKey];
  if (!achievement) return { ok: false, reason: 'unknown achievement' };
  if (PACKAGES.achievementNFT === '0x0') {
    console.warn('[sui] AchievementNFT package not deployed');
    return { ok: false, reason: 'package not deployed' };
  }
  try {
    const keypair = getKeypair();
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${PACKAGES.achievementNFT}::achievement_nft::mint`,
      arguments: [
        tx.pure(walletAddr),
        tx.pure(achievement.id),
        tx.pure(achievement.name),
        tx.pure(achievement.desc),
        tx.pure(Math.floor(Date.now() / 1000)),
      ],
    });
    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair, transactionBlock: tx,
      options: { showEffects: true, showObjectChanges: true },
    });
    const nftId = result.objectChanges?.find(c => c.type === 'created')?.objectId;
    return { ok: true, digest: result.digest, nftId, achievement };
  } catch (err) {
    console.error('[sui] mintAchievement error:', err.message);
    return { ok: false, error: err.message };
  }
}

/* ── ACHIEVEMENT CHECKS ── */
function checkAchievements(player, gameResult) {
  const earned = [];
  const { role, won, allTasksDone, survived, neverVotedAgainst, incorrectEjectionsTotal, clutchFix } = gameResult;

  if (role === 'crewmate' && allTasksDone && survived && player.votedCorrectly > 0 && player.votedIncorrectly === 0) {
    earned.push('PERFECT_CREWMATE');
  }
  if (role === 'impostor' && won && neverVotedAgainst) {
    earned.push('GHOST_PROTOCOL');
  }
  if (clutchFix) {
    earned.push('CLUTCH_FIX');
  }
  if (incorrectEjectionsTotal >= 10) {
    earned.push('SUS_LORD');
  }
  return earned;
}

module.exports = {
  client, PACKAGES, calcRepDelta,
  registerGameOnchain, updateReputation, getReputation,
  createStakingPool, distributeWinnings,
  mintAchievement, checkAchievements, ACHIEVEMENTS,
};
