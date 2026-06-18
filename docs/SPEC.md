# Impostor Protocol — Full Product Specification
## Sui Overflow 2026 Submission

---

## What We're Building

**One-liner:** The first onchain social deduction game on Sui — Among Us with real stakes, persistent identity, and AI opponents that never let the lobby go empty.

---

## Why We're Building It

Among Us has 500 million downloads. It is the most played social deduction game ever built. But it has a fundamental architectural problem that nobody has solved: **every game is a ghost. Nothing persists.**

You finish a match — your reputation disappears. Your clutch play as impostor — gone. Your perfect crewmate record — meaningless. The next lobby doesn't know who you are.

Sui fixes this. When your wallet is your player:

- Your kill history is onchain. Permanent.
- Your voting record is onchain (with privacy-aware tiers — see Design Decisions below).
- Your task completion rate is onchain. Verifiable.
- Your reputation precedes you into every lobby.

And the second problem: **dead lobbies.** We solve this with AI agents that have persistent memory via Walrus — they learn from past games, adapt strategies, and keep the game alive when real players aren't online.

---

## Design Decisions (post-review revisions)

Early review flagged real risks in the original design. These were the fixes:

1. **Public vs private reputation.** Full vote/kill history made public would let players profile each other and kill the deception that makes social deduction fun. Fix: public profile shows reputation score, achievements, and total games (after a 50+ game threshold to avoid small-sample tells). Kill history, vote history, and behavioral patterns stay private — visible only to the AI agent layer for matchmaking and play, never surfaced to other humans.

2. **AI agent ambition.** A fully agentic, highly "intelligent" AI risks feeling erratic or annoying rather than convincing. Fix: simple state machine for movement/task/kill decisions, Claude API only for in-meeting dialogue. The goal is "doesn't feel embarrassing," not "wins MENSA."

3. **Walrus as source of truth.** Walrus is a storage layer, not a low-latency game server. Fix: WebSocket server stays authoritative during live gameplay; Walrus receives periodic snapshots (every 5s) for persistence, recovery, replay, and AI memory.

4. **Mandatory staking.** Forcing a stake on every game would shrink the casual audience before it ever forms. Fix: three tiers — Casual (free), Ranked (optional stake), Tournament (mandatory stake, future).

5. **Match replay.** The single highest-leverage addition from review. A permanent, verifiable, Walrus-archived replay of every match answers the judge's hardest question — "why not just use a database?" — and doubles as a built-in content/growth loop (clutch plays and controversial votes get shared).

---

## The Sui Overflow Angle

Judging weights: real-world application (50%), product & UX (20%), technical implementation (20%), presentation & vision (10%).

**Real-world application:** 500M existing players is the largest addressable user base of any plausible Overflow submission. The problem (no persistence, no stakes, no identity) is real and the fix is direct.

**Product & UX:** Browser-based, no download, wallet connect to play in under 60 seconds.

**Technical implementation:** Walrus for persistence + AI memory, Sui Move for staking/reputation/registry, WebSocket for real-time play, Claude API for agent dialogue.

**Presentation & vision:** The demo plays itself — live game, wallet reputation screen, AI agent making an accusation in a meeting, full Walrus replay.

### Track coverage

**Primary — Walrus ($35,000 1st prize).** Game state persistence, AI agent memory, and full match replay are not bolted on — they're the technical core of the project.

**Secondary — Agentic Web ($30,000 1st prize).** AI agents are a core gameplay primitive, not a fallback feature: they hold roles, make decisions from game state, participate in meetings, and carry memory across sessions via Walrus.

---

## Full Feature Specification

### Core gameplay (full Among Us mechanics)

- 4–10 players per session (real + AI fill)
- Single map for v1: **The Ledger** — a Sui-themed spaceship (Validator Bay, Object Store, Consensus Chamber, Treasury, Vent Network)

**Crewmate roles:** Crewmate, Engineer (limited vent access), Scientist (remote vitals check), Tracker (place tracker on one player)

**Impostor roles:** Impostor (kill/vent/sabotage/fake tasks), Shapeshifter (temporarily copy another player's appearance)

**Tasks (browser mini-games):** Fix Wiring, Swipe Card, Chart Course, Upload Data (two-step), Calibrate Distributor, Start Reactor (Simon Says)

**Sabotages:** Lights, O2 (45s timer, two locations), Reactor (30s timer, two simultaneous panels), Comms (disables task tracking/vitals)

**Meetings:** Emergency button (1 use/player/game), report body (instant meeting), 30s discussion, 20s voting, skip option, ejection reveals wallet address

**Win conditions:** Crewmates win via all tasks complete or all impostors ejected. Impostors win via parity (living players = impostor count) or critical sabotage timeout.

**Ghost mechanics:** Dead crewmates can finish tasks; dead impostors can still sabotage; ghosts can't speak in meetings.

### Persistence layer — Walrus

- **Game state blobs:** written every 5s — positions, task status, roles, deaths, sabotage state, meeting/vote history
- **Player profile blobs:** games played, win rates, kill rate, task completion rate, suspicion score
- **AI agent memory blobs:** observed player behaviors, known tells per wallet, strategy weights, evolves over time

### AI agents — Agentic Web

- Trigger: lobby has fewer than 4 real players after 60s wait
- Architecture: Claude API call per agent, with system prompt (role), current game state, player history from memory blob, available actions
- Decision loop every 3s: read state → evaluate role-based actions → return action (move / task / kill / vent / call meeting / vote)
- Meeting behavior: reads chat history, generates contextual accusation/defense, votes based on evidence + memory, can be questioned by real players

### Onchain layer — Sui Move

- **Staking contract:** 0.1+ SUI minimum for ranked, locked for game duration, winners split pot
- **Reputation contract:** starts at 1000; +25 correct vote, -15 false accusation, +30 survive+all tasks, +50 impostor win unsuspected, -10 ejected innocent, -50 rage quit
- **Achievement NFTs:** Perfect Crewmate, Ghost Protocol, Clutch Fix, Sus Lord
- **Game registry:** every completed game written onchain — immutable record for leaderboards and reputation calc

### Session persistence & reconnection

- WebSocket server is authoritative; Sui contract logs a session checkpoint (session ID, Walrus blob CID, timestamp, player list) on every state write
- Reconnect flow: connect wallet → contract checks for active session → fetch latest Walrus blob → reconstruct state → rejoin in exact position
- Reconnect window: 90 seconds before replacement by AI agent

### Frontend

- React + Vite, Sui TypeScript SDK, WebSocket (Node + Express on Render), Walrus TypeScript SDK, Canvas API for map rendering
- Screens: lobby, game canvas, task overlays, meeting screen, reputation dashboard, leaderboard
- Share-to-X: end-of-game shareable card with role, result, key stat, wallet address, reputation score

---

## What ships in the hackathon build window

- Day 1–2: Smart contracts (staking, reputation, registry) → Sui testnet
- Day 3–4: Core game loop — map render, movement, tasks (3 of 6), kill mechanic, meetings
- Day 5: Walrus integration — state persistence, reconnect, profile blobs
- Day 6: AI agents — crewmate + impostor types, meeting participation, lobby fill
- Day 7: Full integration — stake flow, reputation updates, achievement NFTs, share card
- Day 8: Polish, demo video, submission

**Submission scope:** live testnet game with real wallet connect, 1 map, 6 tasks, full impostor mechanics, meeting system, working Walrus reconnect (reload mid-game and resume), AI lobby fill, reputation dashboard, share-to-X card, demo video.

---

**Track:** Walrus (Primary) + Agentic Web (Secondary)
**Chain:** Sui Testnet → Mainnet post-hackathon
**Stack:** React + Vite / Node + Express / Sui Move / Walrus SDK / Claude API
**Deploy:** Render
**Submission deadline:** June 21, 2026
