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
| Wallet auth | `public/auth.html` | Built |
| Game lobby | `public/lobby.html` | Built — UI only, **not yet wired to the server** |
| Game canvas | `public/game.html` | Built — **wired to the real WebSocket server** (see note below) |
| WebSocket server | `server/` | Built — not yet deployed |
| Smart contracts (Move) | `contracts/` | Built (4/4) — not yet deployed |
| Walrus integration | `server/walrus.js` | Built — real HTTP client, not yet tested against live testnet |
| AI agent layer | `server/gameState.js` (tickAI) | Built — simple state machine, no Claude API dialogue yet |

**Note on `game.html`:** this page now supports two modes:
- **Online** — pass `?room=CODE&wallet=0x..&name=You&color=%23117f2d` in the URL and it connects to the real server in `server/`: real movement sync, server-validated kills/tasks/votes, server-driven AI, Walrus reconnect.
- **Offline** — no `?room=` param falls back to the original local simulation (useful for quick visual iteration without running the server).

**Known gap:** `lobby.html` is still a UI-only mockup — it doesn't call `room:create`/`room:join` on the server, so the room code and player list you see there aren't real yet. `enterGame()` passes whatever room code is on screen through to `game.html`, but until the lobby itself is wired, that code won't correspond to an actual server room. Wiring the lobby the same way `game.html` was wired is the next task.

**Track:** submitting under **Walrus** only. The Agentic Web work (AI agents in `server/gameState.js`, `server/walrus.js` agent memory functions) stays in the codebase and supports the Walrus story — AI agent memory is itself a Walrus persistence use case — but is not the track being judged.

## Running locally

**Frontend** (static, no build step):
```bash
cd public
python3 -m http.server 8000
# visit http://localhost:8000
```

Flow: `index.html` → tap to play → intro animation → `auth.html` → connect wallet → `lobby.html` → start game → role reveal → `game.html` (live game canvas).

**Offline test** (no server needed): `game.html?role=crewmate` or `game.html?role=impostor`

**Online test** (server must be running, see below): `game.html?room=TESTROOM&wallet=0xabc123&name=Dave&color=%23117f2d` — open it twice with different `wallet`/`name` values in two tabs to simulate two real players in the same room.

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

## Team

Built by [@dontfadedave](https://x.com/dontfadedave) — solo Web3 full-stack builder.

## License

MIT — see [`LICENSE`](LICENSE).
