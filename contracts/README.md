# Impostor Protocol — Move Contracts

Four modules, one package, deployed together to Sui testnet.

| Module | File | Purpose |
|---|---|---|
| `game_registry` | `sources/game_registry.move` | Immutable onchain log of every completed game — players, roles, winner, duration, Walrus replay blob ID |
| `reputation` | `sources/reputation.move` | Per-wallet reputation score, starts at 1000, updated after every game |
| `staking` | `sources/staking.move` | Holds SUI stakes for ranked games, splits the pot among winners on game end |
| `achievement_nft` | `sources/achievement_nft.move` | Mintable NFT badges: Perfect Crewmate, Ghost Protocol, Clutch Fix, Sus Lord |

## Design notes

- **Server-gated writes, public reads.** Every write entry function takes a `ServerCap` — only the deployer (the game server's wallet) can call `update_score`, `register_game`, `distribute`, `mint`, etc. Anyone can read scores, game records, and pool state for free via `devInspectTransactionBlock`.
- **Shared objects.** `GameRegistry`, `ReputationStore`, and `PoolRegistry` are shared singletons created once in `init()`. Each completed game creates its own `GameRecord`; each ranked room creates its own `StakePool`.
- **No on-chain randomness needed.** Role assignment (crewmate/impostor) happens server-side before the game starts — the contracts only record the *result*, not the live game logic. Sui is the ledger, not the game engine (see `docs/SPEC.md` design decisions).

## Prerequisites

```bash
# Install Sui CLI if you haven't
curl -fLJO https://github.com/MystenLabs/sui/releases/latest/download/sui-testnet-x86_64-unknown-linux-gnu.tgz

# Configure for testnet + make sure your active address has gas
sui client active-address
sui client faucet   # get testnet SUI if balance is low
```

## Deploy

```bash
cd contracts
./deploy.sh
```

This builds, publishes, and prints the package ID plus next steps for grabbing object IDs out of `deploy_output.json`.

## After deploying

You need 4 things in `server/.env`:

1. **Package ID** — same for all 4 `*_PACKAGE` vars (one package, four modules)
2. **GameRegistry object ID** — the shared `GameRegistry` object
3. **ReputationStore object ID** — the shared `ReputationStore` object
4. **PoolRegistry object ID** — the shared `PoolRegistry` object
5. **ServerCap object IDs** — one per module, held by the deployer wallet, passed as the `_cap` argument on every gated call

All of these appear in `deploy_output.json` under `objectChanges`. Search for `"type": "created"` entries and match by `objectType`.

## Testing locally before deploying

```bash
sui move test
```

(Unit tests are not included in this build pass — see `docs/SPEC.md` for what's still pending.)
