# Impostor Protocol

**Social deduction on Sui — Among Us with persistent identity, real stakes, and AI opponents that never let the lobby go empty.**

Built for [Sui Overflow 2026](https://mystenlabs.notion.site/overflow-2026-handbook) — targeting the **Walrus** (primary) and **Agentic Web** (secondary) tracks.

---

## What this is

Among Us has 500M+ downloads and zero persistent identity. Every match is a ghost — your reputation, your record, your best impostor run, gone the moment the lobby closes.

Impostor Protocol fixes that:

- **Your wallet is your crewmate.** Reputation lives onchain, forever.
- **Walrus session persistence.** Close the tab, lose signal — reconnect and resume exactly where you left off.
- **AI agents fill empty lobbies.** No players online? AI crewmates and impostors with persistent Walrus memory keep the game alive.
- **Full match replay.** Every game archived on Walrus — watch the timeline back, share your best runs.

See [`docs/SPEC.md`](docs/SPEC.md) for the full product specification.

## Current status

This repo currently contains the **frontend flow** — landing, wallet auth, and game lobby. The live game canvas (map, tasks, meetings, voting) is the next build.

| Page | File | Status |
|---|---|---|
| Landing / intro | `public/index.html` | Built |
| Wallet auth | `public/auth.html` | Built — wallet address is mocked (random hex), real wallet extension integration not done |
| Game lobby | `public/lobby.html` | Built — **wired to the real WebSocket server** |
| Game canvas | `public/game.html` | Built — **wired to the real WebSocket server** |
| Profile / achievements | `public/profile.html` | Built — reputation is live (`GET /rep/:wallet`); achievements and match history show honest locked/empty state until a per-wallet history endpoint exists (see Known gaps) |
| WebSocket server | `server/` | Built — not yet deployed |
| Smart contracts (Move) | `contracts/` | Built (4/4) — not yet deployed |
| Walrus integration | `server/walrus.js` | Built — real HTTP client, not yet tested against live testnet |
| AI agent layer | `server/gameState.js` (tickAI) | Built — simple state machine, no Claude API dialogue yet |

**The full flow is now real, end to end:** `auth.html` generates a wallet address and passes it forward → `lobby.html` creates or joins an actual server room, shows real connected players, sends real chat, and starts a real game → `game.html` connects to that same room with real movement/kill/task/vote sync.

**What's still mocked:** the wallet connection itself (`auth.html` generates a random address rather than calling a real Sui Wallet/Suiet/Ethos browser extension). Everything *after* that point — lobby, game, server, contracts — operates on whatever address it's given as if it were real.

**Track:** submitting under **Walrus** only. The Agentic Web work (AI agents in `server/gameState.js`, `server/walrus.js` agent memory functions) stays in the codebase and supports the Walrus story — AI agent memory is itself a Walrus persistence use case — but is not the track being judged.

## Running locally

**Frontend** (static, no build step):
```bash
cd public
python3 -m http.server 8000
# visit http://localhost:8000
```

Flow: `index.html` → tap to play → intro animation → `auth.html` → connect wallet → `lobby.html` → start game → role reveal → `game.html` (live game canvas).

**With the server running** (see below), this entire flow is real: `auth.html` generates a wallet identity, `lobby.html` creates an actual room on the server and shows real connected players, and `game.html` joins that same room.

**Offline test** (no server needed, skips straight to a fake game): `game.html?role=crewmate` or `game.html?role=impostor`

**Online test, single browser:** start at `auth.html`, click through to lobby — it'll create a real (empty) room and wait for 4 players. Use AI fill by starting anyway once you've got 4 browser tabs/devices in the same room (share the room code shown top-center).

**Online test, multiple tabs:** open `lobby.html?wallet=0xaaa&name=Alice` in one tab to create a room, note the room code it shows, then open `lobby.html?wallet=0xbbb&name=Bob&room=THECODE` in another tab to join it.

**Server** (WebSocket game server):
```bash
cd server
npm install
cp .env.example .env   # fill in contract addresses after deploying
npm run dev
```

**Contracts** (Sui Move):
```bash
cd contracts
./deploy.sh
```
See `contracts/README.md` for full deployment details and what to do with the output.

## Design language

Dark, brutal, terminal-on-a-dying-ship aesthetic. Bebas Neue for display type, Share Tech Mono for system text, Barlow Condensed for body copy. Diagonal clip-path cuts instead of rounded corners. Teal (`#00c4b4`) as the primary atmosphere color, red (`#e8122c`) reserved for danger/impostor moments.

## Controls (desktop only)

| Key | Action |
|---|---|
| `↑ ↓ ← →` | Move |
| `E` | Use / Task |
| `Q` | Kill (impostor) |
| `F` | Vent (impostor) |
| `R` | Report body |
| `Space` | Emergency meeting |

## Track alignment

**Walrus (primary, $35K 1st):** Session state snapshots, AI agent memory, full match replay — all stored on Walrus as the permanent, verifiable record of every game played.

**Agentic Web (secondary, $30K 1st):** AI agents with persistent Walrus memory fill lobbies, play full games, and participate in meetings via Claude API.

## Known gaps

Honest list of what's mocked or missing, consolidated from comments scattered across the codebase:

- **Wallet connection is mocked.** `auth.html` generates a random hex string instead of calling a real Sui Wallet / Suiet / Ethos browser extension. Everything downstream (lobby, game, server, contracts) treats that string as if it were a real address.
- **No per-wallet history endpoint.** The server can tell you a wallet's current reputation (`GET /rep/:wallet`) but has no way to list "all achievements earned by wallet X" or "all matches played by wallet X" — match replays are saved to Walrus per-room but never indexed by player. `profile.html` shows an honest locked/empty state rather than fabricating this data.
- **Nothing is deployed.** The server runs locally only; the Move contracts are written and have a deploy script but haven't been published to testnet.
- **AI dialogue is a state machine, not Claude API.** `server/gameState.js`'s `tickAI()` makes simple proximity-based decisions (wander, complete nearby task, kill nearby crewmate). It doesn't generate natural-language meeting arguments yet.
- **Walrus integration is untested against live testnet.** `server/walrus.js` is a real HTTP client built against Walrus's documented API shape, but has not yet been run against the actual testnet aggregator/publisher.

## Team

Built by [@dontfadedave](https://x.com/dontfadedave) — solo Web3 full-stack builder.

## License

MIT — see [`LICENSE`](LICENSE).
