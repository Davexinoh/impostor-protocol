// contracts/sources/staking.move
// Holds SUI stakes for ranked games. Locks funds for game duration.
// Winners split the pot on game end. Casual mode bypasses this entirely.

module impostor_protocol::staking {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use std::string::{Self, String};
    use std::vector;

    // ── ERRORS ──
    const ENotAuthorized:     u64 = 0;
    const EPoolNotFound:      u64 = 1;
    const EPoolAlreadyExists: u64 = 2;
    const EInsufficientStake: u64 = 3;
    const ENoWinners:         u64 = 4;
    const EPoolAlreadySettled: u64 = 5;

    const SIDE_CREW:     u8 = 0;
    const SIDE_IMPOSTOR: u8 = 1;

    // ── STRUCTS ──

    /// One pool per ranked game room
    struct StakePool has key, store {
        id: UID,
        room_code: String,
        stake_per_player: u64,
        pot: Balance<SUI>,
        stakers: vector<address>,
        settled: bool,
    }

    /// Shared registry mapping room_code → pool address
    struct PoolRegistry has key {
        id: UID,
        pools: Table<String, address>,
        admin: address,
    }

    struct ServerCap has key, store { id: UID }

    // ── EVENTS ──

    struct PoolCreated has copy, drop {
        room_code: String,
        stake_per_player: u64,
    }

    struct StakeDeposited has copy, drop {
        room_code: String,
        player: address,
        amount: u64,
    }

    struct PoolSettled has copy, drop {
        room_code: String,
        winning_side: u8,
        winners: vector<address>,
        payout_each: u64,
    }

    // ── INIT ──

    fun init(ctx: &mut TxContext) {
        let registry = PoolRegistry {
            id: object::new(ctx),
            pools: table::new(ctx),
            admin: tx_context::sender(ctx),
        };
        transfer::share_object(registry);

        let cap = ServerCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // ── CREATE POOL ──

    public entry fun create_pool(
        registry:  &mut PoolRegistry,
        _cap:      &ServerCap,
        room_code: vector<u8>,
        stake_per_player: u64,
        ctx: &mut TxContext,
    ) {
        let code_str = string::utf8(room_code);
        assert!(!table::contains(&registry.pools, code_str), EPoolAlreadyExists);

        let pool = StakePool {
            id: object::new(ctx),
            room_code: code_str,
            stake_per_player,
            pot: balance::zero(),
            stakers: vector::empty(),
            settled: false,
        };

        let pool_addr = object::id_address(&pool);
        table::add(&mut registry.pools, code_str, pool_addr);

        event::emit(PoolCreated { room_code: code_str, stake_per_player });
        transfer::share_object(pool);
    }

    // ── DEPOSIT STAKE ──
    // Player deposits their stake into the shared pool object directly.

    public entry fun deposit_stake(
        pool:    &mut StakePool,
        payment: Coin<SUI>,
        ctx:     &mut TxContext,
    ) {
        let amount = coin::value(&payment);
        assert!(amount >= pool.stake_per_player, EInsufficientStake);
        assert!(!pool.settled, EPoolAlreadySettled);

        let sender = tx_context::sender(ctx);
        balance::join(&mut pool.pot, coin::into_balance(payment));
        vector::push_back(&mut pool.stakers, sender);

        event::emit(StakeDeposited {
            room_code: pool.room_code,
            player: sender,
            amount,
        });
    }

    // ── DISTRIBUTE WINNINGS ──
    // Server calls this with the list of winner addresses.
    // Pot is split evenly among winners.

    public entry fun distribute(
        pool:         &mut StakePool,
        _cap:         &ServerCap,
        winners:      vector<address>,
        winning_side: u8,
        ctx:          &mut TxContext,
    ) {
        assert!(!pool.settled, EPoolAlreadySettled);
        let num_winners = vector::length(&winners);
        assert!(num_winners > 0, ENoWinners);

        let total = balance::value(&pool.pot);
        let payout_each = total / (num_winners as u64);

        let i = 0;
        while (i < num_winners) {
            let winner_addr = *vector::borrow(&winners, i);
            let payout_balance = balance::split(&mut pool.pot, payout_each);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, winner_addr);
            i = i + 1;
        };

        pool.settled = true;

        event::emit(PoolSettled {
            room_code: pool.room_code,
            winning_side,
            winners,
            payout_each,
        });
    }

    // ── REFUND (if game cancelled before start) ──

    public entry fun refund_all(
        pool: &mut StakePool,
        _cap: &ServerCap,
        ctx:  &mut TxContext,
    ) {
        assert!(!pool.settled, EPoolAlreadySettled);
        let num_stakers = vector::length(&pool.stakers);
        if (num_stakers == 0) { pool.settled = true; return };

        let refund_each = balance::value(&pool.pot) / (num_stakers as u64);
        let i = 0;
        while (i < num_stakers) {
            let staker = *vector::borrow(&pool.stakers, i);
            let refund_balance = balance::split(&mut pool.pot, refund_each);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, staker);
            i = i + 1;
        };
        pool.settled = true;
    }

    // ── READ FUNCTIONS ──

    public fun pot_value(pool: &StakePool): u64 {
        balance::value(&pool.pot)
    }

    public fun staker_count(pool: &StakePool): u64 {
        vector::length(&pool.stakers)
    }

    public fun is_settled(pool: &StakePool): bool {
        pool.settled
    }

    public fun pool_address(registry: &PoolRegistry, room_code: String): address {
        *table::borrow(&registry.pools, room_code)
    }

    // ── ADMIN ──

    public entry fun transfer_server_cap(cap: ServerCap, new_server: address) {
        transfer::transfer(cap, new_server);
    }
}
