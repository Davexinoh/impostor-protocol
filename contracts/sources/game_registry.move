// contracts/sources/game_registry.move
// Immutable onchain record of every completed Impostor Protocol game.
// Every match stores: players, roles, winner, duration, timestamp.
// Query for leaderboards and reputation calculation.

module impostor_protocol::game_registry {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::vec_map::{Self, VecMap};
    use std::string::{Self, String};
    use std::vector;

    // ── ERRORS ──
    const ENotAuthorized: u64 = 0;
    const EGameNotFound:  u64 = 1;
    const EAlreadyEnded:  u64 = 2;

    // ── WINNING SIDE ──
    const SIDE_CREW:     u8 = 0;
    const SIDE_IMPOSTOR: u8 = 1;

    // ── ROLE ──
    const ROLE_CREWMATE: u8 = 0;
    const ROLE_IMPOSTOR: u8 = 1;

    // ── STRUCTS ──

    /// Shared singleton — global registry of all games
    struct GameRegistry has key {
        id: UID,
        /// room_code → GameRecord ID
        games: Table<String, address>,
        total_games: u64,
        admin: address,
    }

    /// Created per completed game. Immutable after creation.
    struct GameRecord has key {
        id: UID,
        room_code:    String,
        player_wallets: vector<address>,
        player_roles:   vector<u8>,       // ROLE_CREWMATE | ROLE_IMPOSTOR per index
        winning_side:   u8,               // SIDE_CREW | SIDE_IMPOSTOR
        duration_secs:  u64,
        finished_at:    u64,              // unix timestamp
        walrus_replay_blob: String,       // Walrus blob ID for full replay
    }

    // ── CAPABILITIES ──

    /// Held by the game server — only server can register games
    struct ServerCap has key, store { id: UID }

    // ── INIT ──

    fun init(ctx: &mut TxContext) {
        let registry = GameRegistry {
            id: object::new(ctx),
            games: table::new(ctx),
            total_games: 0,
            admin: tx_context::sender(ctx),
        };
        transfer::share_object(registry);

        // Mint ServerCap to deployer
        let cap = ServerCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // ── REGISTER GAME ──

    public entry fun register_game(
        registry:       &mut GameRegistry,
        _cap:           &ServerCap,
        room_code:      vector<u8>,
        player_wallets: vector<address>,
        player_roles:   vector<u8>,
        winning_side:   u8,
        duration_secs:  u64,
        finished_at:    u64,
        walrus_blob:    vector<u8>,
        ctx:            &mut TxContext,
    ) {
        let code_str = string::utf8(room_code);

        let record = GameRecord {
            id: object::new(ctx),
            room_code: code_str,
            player_wallets,
            player_roles,
            winning_side,
            duration_secs,
            finished_at,
            walrus_replay_blob: string::utf8(walrus_blob),
        };

        let record_addr = object::id_address(&record);
        table::add(&mut registry.games, code_str, record_addr);
        registry.total_games = registry.total_games + 1;

        // Share the record so anyone can query it
        transfer::share_object(record);
    }

    // ── READ FUNCTIONS ──

    public fun total_games(registry: &GameRegistry): u64 {
        registry.total_games
    }

    public fun game_address(registry: &GameRegistry, room_code: String): address {
        *table::borrow(&registry.games, room_code)
    }

    public fun record_players(record: &GameRecord): &vector<address> {
        &record.player_wallets
    }

    public fun record_winning_side(record: &GameRecord): u8 {
        record.winning_side
    }

    public fun record_duration(record: &GameRecord): u64 {
        record.duration_secs
    }

    public fun record_replay_blob(record: &GameRecord): &String {
        &record.walrus_replay_blob
    }

    // ── ADMIN: TRANSFER SERVER CAP ──
    public entry fun transfer_server_cap(cap: ServerCap, new_server: address) {
        transfer::transfer(cap, new_server);
    }
}
