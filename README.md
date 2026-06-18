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
| Game lobby | `public/lobby.html` | Built |
| Game canvas | `public/game.html` | Built (frontend simulation — see note below) |
| Smart contracts (Move) | — | Not started |
| Walrus integration | — | Not started |
| AI agent layer | — | Not started |

**Note on `game.html`:** this is a fully playable frontend simulation — movement, all 6 tasks, kill/vent/report/emergency, meetings, voting, win conditions — running entirely client-side with simulated AI opponents. It is not yet wired to a real multiplayer backend, Sui contracts, or Walrus persistence. That wiring is the next phase.

## Running locally

These are static HTML files with no build step. Just open them in a browser, or serve the `public/` folder:

```bash
cd public
python3 -m http.server 8000
# visit http://localhost:8000
```

Flow: `index.html` → tap to play → intro animation → `auth.html` → connect wallet → `lobby.html` → start game → role reveal → `game.html` (live game canvas).

You can also jump straight into a test round at `game.html?role=crewmate` or `game.html?role=impostor`.

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
