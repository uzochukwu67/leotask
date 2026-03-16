// ============================================================================
// Private Order Book v12 - Keeper Model (ZKPerp-inspired)
// ============================================================================
// Architecture:
//   - Order records owned by ORCHESTRATOR (keeper) - private, encrypted
//   - Users receive Receipt records as proof of order
//   - Only orchestrator can settle/cancel orders
//   - Settlement creates SettlementProof records for traders
//   - No public order book - maximum privacy
// ============================================================================

import credits.aleo;
import mock_usdc_orderbook.aleo;

program private_orderbook_v12.aleo {

    const SETTLER_FEE_BPS: u64 = 10u64;
    const PROTOCOL_FEE_BPS: u64 = 5u64;
    const NATIVE_CREDITS_ID: field = 0field;
    const QUOTE_TOKEN_ID: field = 7002field;  // TKNB on testnet

    // ========== RECORDS ==========

    // Order record - OWNED BY ORCHESTRATOR (private, encrypted)
    // Only keeper can see and settle these orders
    record Order {
        owner: address,           // ORCHESTRATOR (keeper)
        trader: address,          // Who placed the order
        order_id: field,
        pair_id: u64,
        is_buy: bool,
        price: u64,
        quantity: u128,
        escrow_token: field,
        escrow_amount: u128,
        filled: u128,
        created_at: u32,
        expires_at: u32,
    }

    // Receipt record - OWNED BY TRADER (proof of order)
    // User keeps this as proof they placed an order
    record Receipt {
        owner: address,           // TRADER
        order_id: field,
        pair_id: u64,
        is_buy: bool,
        price: u64,
        quantity: u128,
        created_at: u32,
    }

    // Settlement proof - OWNED BY TRADER (proof of fill)
    record SettlementProof {
        owner: address,           // TRADER
        order_id: field,
        fill_quantity: u128,
        fill_price: u64,
        received_token: field,
        received_amount: u128,
        settled_at: u32,
    }

    // Cancellation proof - OWNED BY TRADER (proof of cancellation)
    record CancellationProof {
        owner: address,           // TRADER
        order_id: field,
        returned_amount: u128,
        cancelled_at: u32,
    }

    // ========== STRUCTS ==========

    struct TokenPair {
        base_token_id: field,
        quote_token_id: field,
        tick_size: u64,
        is_active: bool,
    }

    // ========== MAPPINGS (PUBLIC STATE) ==========

    mapping orchestrator: bool => address;
    mapping keepers: address => bool;
    mapping token_pairs: u64 => TokenPair;
    mapping treasury: bool => address;
    mapping pair_volume: u64 => u128;
    mapping order_counter: bool => u64;

    // ========== CONSTRUCTOR ==========
    // Sets self.program_owner as orchestrator automatically at deployment

    @custom
    async constructor() {
        Mapping::set(orchestrator, true, self.program_owner);
        Mapping::set(keepers, self.program_owner, true);
        Mapping::set(order_counter, true, 0u64);
    }

    // ========== ADMIN FUNCTIONS ==========

    async transition add_keeper(keeper: address) -> Future {
        return finalize_add_keeper(self.caller, keeper);
    }

    async function finalize_add_keeper(caller: address, keeper: address) {
        let orch: address = Mapping::get(orchestrator, true);
        assert_eq(caller, orch);
        Mapping::set(keepers, keeper, true);
    }

    async transition remove_keeper(keeper: address) -> Future {
        return finalize_remove_keeper(self.caller, keeper);
    }

    async function finalize_remove_keeper(caller: address, keeper: address) {
        let orch: address = Mapping::get(orchestrator, true);
        assert_eq(caller, orch);
        Mapping::set(keepers, keeper, false);
    }

    async transition set_treasury(new_treasury: address) -> Future {
        return finalize_set_treasury(self.caller, new_treasury);
    }

    async function finalize_set_treasury(caller: address, new_treasury: address) {
        let orch: address = Mapping::get(orchestrator, true);
        assert_eq(caller, orch);
        Mapping::set(treasury, true, new_treasury);
    }

    async transition register_pair(
        pair_id: u64,
        base_token_id: field,
        quote_token_id: field,
        tick_size: u64
    ) -> Future {
        return finalize_register_pair(self.caller, pair_id, base_token_id, quote_token_id, tick_size);
    }

    async function finalize_register_pair(
        caller: address,
        pair_id: u64,
        base_token_id: field,
        quote_token_id: field,
        tick_size: u64
    ) {
        let orch: address = Mapping::get(orchestrator, true);
        assert_eq(caller, orch);
        let pair: TokenPair = TokenPair {
            base_token_id: base_token_id,
            quote_token_id: quote_token_id,
            tick_size: tick_size,
            is_active: true,
        };
        Mapping::set(token_pairs, pair_id, pair);
        Mapping::set(pair_volume, pair_id, 0u128);
    }

    // ========== ORDER SUBMISSION ==========
    // User passes orchestrator_addr - verified against stored value in finalize

    // Submit BUY order with USDC (escrowing quote tokens to buy base)
    // Buyer pays USDC, will receive ALEO on settlement
    async transition submit_buy_order(
        pair_id: u64,
        price: u64,
        quantity: u128,
        escrow_usdc: u128,
        timestamp: u32,
        expires_at: u32,
        orchestrator_addr: address
    ) -> (Order, Receipt, Future) {
        assert(quantity > 0u128);
        assert(price > 0u64);

        let order_id: field = BHP256::hash_to_field(
            self.caller as field + timestamp as field + price as field + quantity as field
        );

        // Order record owned by ORCHESTRATOR (passed as param, verified in finalize)
        let order: Order = Order {
            owner: orchestrator_addr,
            trader: self.caller,
            order_id: order_id,
            pair_id: pair_id,
            is_buy: true,
            price: price,
            quantity: quantity,
            escrow_token: QUOTE_TOKEN_ID,
            escrow_amount: escrow_usdc,
            filled: 0u128,
            created_at: timestamp,
            expires_at: expires_at,
        };

        // Receipt record owned by TRADER (proof)
        let receipt: Receipt = Receipt {
            owner: self.caller,
            order_id: order_id,
            pair_id: pair_id,
            is_buy: true,
            price: price,
            quantity: quantity,
            created_at: timestamp,
        };

        // Transfer USDC escrow to program
        let escrow_future: Future = mock_usdc_orderbook.aleo/transfer_from_public(
            self.caller,
            self.address,
            escrow_usdc
        );

        return (order, receipt, finalize_submit_buy_order(
            pair_id,
            price,
            quantity,
            escrow_usdc,
            orchestrator_addr,
            escrow_future
        ));
    }

    async function finalize_submit_buy_order(
        pair_id: u64,
        price: u64,
        quantity: u128,
        escrow_usdc: u128,
        orchestrator_addr: address,
        escrow_future: Future
    ) {
        // Verify orchestrator matches stored value
        let expected_orch: address = Mapping::get(orchestrator, true);
        assert_eq(orchestrator_addr, expected_orch);

        let pair: TokenPair = Mapping::get(token_pairs, pair_id);
        assert(pair.is_active);

        // Verify buyer escrowed enough USDC: quantity * price / 10000
        let required: u128 = (quantity * price as u128 + 9999u128) / 10000u128;
        assert(escrow_usdc >= required);

        escrow_future.await();

        let counter: u64 = Mapping::get_or_use(order_counter, true, 0u64);
        Mapping::set(order_counter, true, counter + 1u64);
    }

    // Submit SELL order with ALEO (escrowing base tokens to sell for quote)
    // Seller pays ALEO, will receive USDC on settlement
    async transition submit_sell_order(
        pair_id: u64,
        price: u64,
        quantity: u128,
        escrow_credits: u64,
        timestamp: u32,
        expires_at: u32,
        orchestrator_addr: address
    ) -> (Order, Receipt, Future) {
        assert(quantity > 0u128);
        assert(price > 0u64);

        let order_id: field = BHP256::hash_to_field(
            self.caller as field + timestamp as field + price as field + quantity as field
        );

        // Order record owned by ORCHESTRATOR
        let order: Order = Order {
            owner: orchestrator_addr,
            trader: self.caller,
            order_id: order_id,
            pair_id: pair_id,
            is_buy: false,
            price: price,
            quantity: quantity,
            escrow_token: NATIVE_CREDITS_ID,
            escrow_amount: escrow_credits as u128,
            filled: 0u128,
            created_at: timestamp,
            expires_at: expires_at,
        };

        // Receipt record owned by TRADER (proof)
        let receipt: Receipt = Receipt {
            owner: self.caller,
            order_id: order_id,
            pair_id: pair_id,
            is_buy: false,
            price: price,
            quantity: quantity,
            created_at: timestamp,
        };

        // Transfer ALEO escrow to program
        let escrow_future: Future = credits.aleo/transfer_public_as_signer(
            self.address,
            escrow_credits
        );

        return (order, receipt, finalize_submit_sell_order(
            pair_id,
            price,
            quantity,
            escrow_credits as u128,
            orchestrator_addr,
            escrow_future
        ));
    }

    async function finalize_submit_sell_order(
        pair_id: u64,
        price: u64,
        quantity: u128,
        escrow_credits: u128,
        orchestrator_addr: address,
        escrow_future: Future
    ) {
        // Verify orchestrator matches stored value
        let expected_orch: address = Mapping::get(orchestrator, true);
        assert_eq(orchestrator_addr, expected_orch);

        let pair: TokenPair = Mapping::get(token_pairs, pair_id);
        assert(pair.is_active);

        // Verify seller escrowed enough base tokens (quantity)
        assert(escrow_credits >= quantity);

        escrow_future.await();

        let counter: u64 = Mapping::get_or_use(order_counter, true, 0u64);
        Mapping::set(order_counter, true, counter + 1u64);
    }

    // ========== SETTLEMENT (KEEPER ONLY - SINGLE TRANSACTION) ==========
    // Keeper settles matching buy + sell orders in ONE transaction
    // - Buyer receives base tokens (ALEO) from seller's escrow
    // - Seller receives quote tokens (USDC) from buyer's escrow
    // - Keeper receives settler fee
    // - Treasury receives protocol fee

    async transition settle_match(
        buy_order: Order,
        sell_order: Order,
        fill_quantity: u128,
        fill_price: u64,
        timestamp: u32,
        treasury_addr: address
    ) -> (SettlementProof, SettlementProof, Future) {
        // Only keeper (who owns the records) can settle
        assert_eq(buy_order.owner, self.caller);
        assert_eq(sell_order.owner, self.caller);

        // Validate orders match
        assert(buy_order.is_buy);
        assert(!sell_order.is_buy);
        assert_eq(buy_order.pair_id, sell_order.pair_id);
        assert(buy_order.price >= sell_order.price);
        assert(fill_quantity <= buy_order.quantity - buy_order.filled);
        assert(fill_quantity <= sell_order.quantity - sell_order.filled);

        // Calculate amounts:
        // quote_amount = what buyer pays in USDC = fill_quantity * fill_price / 10000
        let quote_amount: u128 = (fill_quantity * fill_price as u128) / 10000u128;
        let settler_fee: u128 = (quote_amount * SETTLER_FEE_BPS as u128) / 10000u128;
        let protocol_fee: u128 = (quote_amount * PROTOCOL_FEE_BPS as u128) / 10000u128;

        // Seller receives USDC minus fees
        let seller_receives_usdc: u128 = quote_amount - settler_fee - protocol_fee;
        // Buyer receives base tokens (ALEO)
        let buyer_receives_base: u128 = fill_quantity;

        // Create settlement proofs for both traders
        let buyer_proof: SettlementProof = SettlementProof {
            owner: buy_order.trader,
            order_id: buy_order.order_id,
            fill_quantity: fill_quantity,
            fill_price: fill_price,
            received_token: NATIVE_CREDITS_ID,
            received_amount: buyer_receives_base,
            settled_at: timestamp,
        };

        let seller_proof: SettlementProof = SettlementProof {
            owner: sell_order.trader,
            order_id: sell_order.order_id,
            fill_quantity: fill_quantity,
            fill_price: fill_price,
            received_token: QUOTE_TOKEN_ID,
            received_amount: seller_receives_usdc,
            settled_at: timestamp,
        };

        // Transfer from program escrow to traders (ONE transaction):
        // 1. Send ALEO to buyer (from seller's escrow held by program)
        let pay_buyer: Future = credits.aleo/transfer_public(
            buy_order.trader,
            buyer_receives_base as u64
        );
        // 2. Send USDC to seller (from buyer's escrow held by program)
        let pay_seller: Future = mock_usdc_orderbook.aleo/transfer_public(
            sell_order.trader,
            seller_receives_usdc as u64
        );
        // 3. Pay settler fee to keeper
        let pay_settler: Future = mock_usdc_orderbook.aleo/transfer_public(
            self.caller,
            settler_fee as u64
        );
        // 4. Pay protocol fee to treasury
        let pay_protocol: Future = mock_usdc_orderbook.aleo/transfer_public(
            treasury_addr,
            protocol_fee as u64
        );

        return (buyer_proof, seller_proof, finalize_settle_match(
            buy_order.pair_id,
            fill_quantity,
            quote_amount,
            self.caller,
            treasury_addr,
            pay_buyer,
            pay_seller,
            pay_settler,
            pay_protocol
        ));
    }

    async function finalize_settle_match(
        pair_id: u64,
        fill_quantity: u128,
        quote_amount: u128,
        caller: address,
        treasury_addr: address,
        pay_buyer: Future,
        pay_seller: Future,
        pay_settler: Future,
        pay_protocol: Future
    ) {
        // Verify caller is a valid keeper
        let is_keeper: bool = Mapping::get_or_use(keepers, caller, false);
        assert(is_keeper);

        // Verify treasury address matches stored value
        let expected_treasury: address = Mapping::get(treasury, true);
        assert_eq(treasury_addr, expected_treasury);

        let pair: TokenPair = Mapping::get(token_pairs, pair_id);
        assert(pair.is_active);

        // Execute all transfers
        pay_buyer.await();
        pay_seller.await();
        pay_settler.await();
        pay_protocol.await();

        // Update volume
        let volume: u128 = Mapping::get_or_use(pair_volume, pair_id, 0u128);
        Mapping::set(pair_volume, pair_id, volume + quote_amount);
    }

    // ========== CANCELLATION (KEEPER ONLY) ==========

    // Cancel buy order - refund USDC to trader
    async transition cancel_buy_order(
        order: Order,
        timestamp: u32
    ) -> (CancellationProof, Future) {
        assert_eq(order.owner, self.caller);
        assert(order.is_buy);

        let refund_amount: u128 = order.escrow_amount - order.filled;

        let proof: CancellationProof = CancellationProof {
            owner: order.trader,
            order_id: order.order_id,
            returned_amount: refund_amount,
            cancelled_at: timestamp,
        };

        let refund_future: Future = mock_usdc_orderbook.aleo/transfer_public(
            order.trader,
            refund_amount as u64
        );

        return (proof, finalize_cancel_order(self.caller, refund_future));
    }

    // Cancel sell order - refund ALEO to trader
    async transition cancel_sell_order(
        order: Order,
        timestamp: u32
    ) -> (CancellationProof, Future) {
        assert_eq(order.owner, self.caller);
        assert(!order.is_buy);

        let refund_amount: u128 = order.escrow_amount - order.filled;

        let proof: CancellationProof = CancellationProof {
            owner: order.trader,
            order_id: order.order_id,
            returned_amount: refund_amount,
            cancelled_at: timestamp,
        };

        let refund_future: Future = credits.aleo/transfer_public(
            order.trader,
            refund_amount as u64
        );

        return (proof, finalize_cancel_order(self.caller, refund_future));
    }

    async function finalize_cancel_order(caller: address, refund_future: Future) {
        let is_keeper: bool = Mapping::get_or_use(keepers, caller, false);
        assert(is_keeper);
        refund_future.await();
    }

    // ========== SPLIT ORDER (PARTIAL FILL) ==========

    transition split_order(
        order: Order,
        fill_quantity: u128
    ) -> (Order, Order) {
        // Only keeper can split
        assert_eq(order.owner, self.caller);
        assert(fill_quantity < order.quantity);
        assert(fill_quantity > 0u128);

        let remaining_quantity: u128 = order.quantity - fill_quantity;
        let fill_escrow: u128 = (order.escrow_amount * fill_quantity) / order.quantity;
        let remaining_escrow: u128 = order.escrow_amount - fill_escrow;

        let fill_order: Order = Order {
            owner: self.caller,
            trader: order.trader,
            order_id: order.order_id,
            pair_id: order.pair_id,
            is_buy: order.is_buy,
            price: order.price,
            quantity: fill_quantity,
            escrow_token: order.escrow_token,
            escrow_amount: fill_escrow,
            filled: 0u128,
            created_at: order.created_at,
            expires_at: order.expires_at,
        };

        let new_order_id: field = BHP256::hash_to_field(order.order_id + remaining_quantity as field);
        let remaining_order: Order = Order {
            owner: self.caller,
            trader: order.trader,
            order_id: new_order_id,
            pair_id: order.pair_id,
            is_buy: order.is_buy,
            price: order.price,
            quantity: remaining_quantity,
            escrow_token: order.escrow_token,
            escrow_amount: remaining_escrow,
            filled: 0u128,
            created_at: order.created_at,
            expires_at: order.expires_at,
        };

        return (fill_order, remaining_order);
    }
}
