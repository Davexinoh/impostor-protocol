// contracts/sources/reputation.move
// Per-wallet reputation score stored onchain.
// Starts at 1000. Updated after every game.
// Public read, server-gated write.

module impostor_protocol::reputation {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::event;

    // ── ERRORS ──
    const ENotAuthorized: u64 = 0;
    const EScoreWouldUnderflow: u64 = 1;

    // ── CONSTANTS ──
    const STARTING_SCORE: u64 = 1000;
    const MIN_SCORE:      u64 = 0;
    const MAX_SCORE:      u64 = 999999;

    // ── STRUCTS ──

    /// Shared singleton — global rep store
    struct ReputationStore has key {
        id: UID,
        /// wallet → score
        scores: Table<address, u64>,
        /// wallet → games_played (for profile queries)
        games_played: Table<address, u64>,
        admin: address,
    }

    /// Held by game server to authorize score updates
    struct ServerCap has key, store { id: UID }

    // ── EVENTS ──

    struct ScoreUpdated has copy, drop {
        wallet:    address,
        old_score: u64,
        new_score: u64,
        delta:     u64,
        positive:  bool,
    }

    // ── INIT ──

    fun init(ctx: &mut TxContext) {
        let store = ReputationStore {
            id: object::new(ctx),
            scores: table::new(ctx),
            games_played: table::new(ctx),
            admin: tx_context::sender(ctx),
        };
        transfer::share_object(store);

        let cap = ServerCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // ── ENSURE WALLET IS INITIALIZED ──

    fun ensure_initialized(store: &mut ReputationStore, wallet: address) {
        if (!table::contains(&store.scores, wallet)) {
            table::add(&mut store.scores, wallet, STARTING_SCORE);
            table::add(&mut store.games_played, wallet, 0);
        }
    }

    // ── UPDATE SCORE ──

    public entry fun update_score(
        store:    &mut ReputationStore,
        _cap:     &ServerCap,
        wallet:   address,
        delta:    u64,
        positive: bool,
        _ctx:     &mut TxContext,
    ) {
        ensure_initialized(store, wallet);

        let old = *table::borrow(&store.scores, wallet);
        let new_score = if (positive) {
            let sum = old + delta;
            if (sum > MAX_SCORE) MAX_SCORE else sum
        } else {
            if (delta > old) MIN_SCORE else old - delta
        };

        *table::borrow_mut(&mut store.scores, wallet) = new_score;

        event::emit(ScoreUpdated {
            wallet, old_score: old, new_score,
            delta, positive,
        });
    }

    // ── INCREMENT GAMES PLAYED ──

    public entry fun increment_games(
        store:  &mut ReputationStore,
        _cap:   &ServerCap,
        wallet: address,
        _ctx:   &mut TxContext,
    ) {
        ensure_initialized(store, wallet);
        let count = table::borrow_mut(&mut store.games_played, wallet);
        *count = *count + 1;
    }

    // ── READ FUNCTIONS ──

    public fun get_score(store: &ReputationStore, wallet: address): u64 {
        if (table::contains(&store.scores, wallet)) {
            *table::borrow(&store.scores, wallet)
        } else {
            STARTING_SCORE
        }
    }

    public fun get_games_played(store: &ReputationStore, wallet: address): u64 {
        if (table::contains(&store.games_played, wallet)) {
            *table::borrow(&store.games_played, wallet)
        } else {
            0
        }
    }

    public fun starting_score(): u64 { STARTING_SCORE }

    // ── ADMIN ──

    public entry fun transfer_server_cap(cap: ServerCap, new_server: address) {
        transfer::transfer(cap, new_server);
    }
}
