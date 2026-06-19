// contracts/sources/achievement_nft.move
// Onchain achievement badges. Minted by the server when a player hits
// a milestone: Perfect Crewmate, Ghost Protocol, Clutch Fix, Sus Lord.
// Each NFT is permanent proof of that moment — tradeable, displayable.

module impostor_protocol::achievement_nft {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::event;
    use sui::display;
    use sui::package;
    use std::string::{Self, String};

    // ── ACHIEVEMENT IDS ──
    const ACHIEVEMENT_PERFECT_CREWMATE: u8 = 0;
    const ACHIEVEMENT_GHOST_PROTOCOL:   u8 = 1;
    const ACHIEVEMENT_CLUTCH_FIX:       u8 = 2;
    const ACHIEVEMENT_SUS_LORD:         u8 = 3;

    // ── ERRORS ──
    const ENotAuthorized: u64 = 0;
    const EInvalidAchievementId: u64 = 1;

    // ── STRUCTS ──

    /// The NFT itself
    struct Achievement has key, store {
        id: UID,
        achievement_id: u8,
        name: String,
        description: String,
        recipient: address,
        room_code: String,
        minted_at: u64,
        image_url: String,
    }

    struct ServerCap has key, store { id: UID }

    /// One-time witness for Display setup
    struct ACHIEVEMENT_NFT has drop {}

    // ── EVENTS ──

    struct AchievementMinted has copy, drop {
        achievement_id: u8,
        name: String,
        recipient: address,
        nft_id: ID,
    }

    // ── INIT ──

    fun init(otw: ACHIEVEMENT_NFT, ctx: &mut TxContext) {
        let cap = ServerCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));

        // Set up Display so wallets/explorers render the NFT nicely
        let publisher = package::claim(otw, ctx);
        let keys = vector[
            string::utf8(b"name"),
            string::utf8(b"description"),
            string::utf8(b"image_url"),
            string::utf8(b"project_url"),
        ];
        let values = vector[
            string::utf8(b"{name}"),
            string::utf8(b"{description}"),
            string::utf8(b"{image_url}"),
            string::utf8(b"https://github.com/Davexinoh/impostor-protocol"),
        ];
        let disp = display::new_with_fields<Achievement>(&publisher, keys, values, ctx);
        display::update_version(&mut disp);

        transfer::public_transfer(publisher, tx_context::sender(ctx));
        transfer::public_transfer(disp, tx_context::sender(ctx));
    }

    // ── MINT ──

    public entry fun mint(
        _cap:           &ServerCap,
        recipient:      address,
        achievement_id: u8,
        name:           vector<u8>,
        description:    vector<u8>,
        room_code:      vector<u8>,
        minted_at:      u64,
        ctx:            &mut TxContext,
    ) {
        assert!(achievement_id <= ACHIEVEMENT_SUS_LORD, EInvalidAchievementId);

        let image_url = achievement_image_url(achievement_id);

        let nft = Achievement {
            id: object::new(ctx),
            achievement_id,
            name: string::utf8(name),
            description: string::utf8(description),
            recipient,
            room_code: string::utf8(room_code),
            minted_at,
            image_url,
        };

        let nft_id = object::id(&nft);

        event::emit(AchievementMinted {
            achievement_id,
            name: string::utf8(name),
            recipient,
            nft_id,
        });

        transfer::public_transfer(nft, recipient);
    }

    // ── IMAGE URL PER ACHIEVEMENT ──
    // Points to assets hosted alongside the frontend (or Walrus in future)

    fun achievement_image_url(achievement_id: u8): String {
        if (achievement_id == ACHIEVEMENT_PERFECT_CREWMATE) {
            string::utf8(b"https://raw.githubusercontent.com/Davexinoh/impostor-protocol/main/public/assets/achievements/perfect-crewmate.png")
        } else if (achievement_id == ACHIEVEMENT_GHOST_PROTOCOL) {
            string::utf8(b"https://raw.githubusercontent.com/Davexinoh/impostor-protocol/main/public/assets/achievements/ghost-protocol.png")
        } else if (achievement_id == ACHIEVEMENT_CLUTCH_FIX) {
            string::utf8(b"https://raw.githubusercontent.com/Davexinoh/impostor-protocol/main/public/assets/achievements/clutch-fix.png")
        } else {
            string::utf8(b"https://raw.githubusercontent.com/Davexinoh/impostor-protocol/main/public/assets/achievements/sus-lord.png")
        }
    }

    // ── READ FUNCTIONS ──

    public fun achievement_id(nft: &Achievement): u8 { nft.achievement_id }
    public fun name(nft: &Achievement): &String { &nft.name }
    public fun recipient(nft: &Achievement): address { nft.recipient }
    public fun room_code(nft: &Achievement): &String { &nft.room_code }

    // ── ADMIN ──

    public entry fun transfer_server_cap(cap: ServerCap, new_server: address) {
        transfer::transfer(cap, new_server);
    }
}
