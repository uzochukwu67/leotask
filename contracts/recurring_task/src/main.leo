// ============================================================================
// Private Order Book v16 - Multi-Token Support
// ============================================================================
// Architecture:
//   - Order records owned by ORCHESTRATOR (keeper) - private, encrypted
//   - Users receive Receipt records as proof of order
//   - Only orchestrator can settle/cancel orders
//   - Settlement creates SettlementProof records for traders
//
// Token Design:
//   - Base token: Native ALEO (via credits.aleo)
//   - Quote token: Any ARC20 token (via token_registry.aleo)
//   - Supports any ALEO/TOKEN pair where TOKEN is registered in token_registry
// ============================================================================

import credits.aleo;
import token_registry.aleo;

program recurring_task.aleo {

    // Fee constants (in basis points, 1 bp = 0.01%)
    const SETTLER_FEE_BPS: u64 = 10u64;    // 0.10% settler fee
    const PROTOCOL_FEE_BPS: u64 = 5u64;    // 0.05% protocol fee

    // ========== RECORDS ==========

    // Order record - OWNED BY ORCHESTRATOR (private, encrypted)
    record Order {
        owner: address,           // ORCHESTRATOR (keeper)
        trader: address,          // Who placed the order
        order_id: field,
        pair_id: u64,
        is_buy: bool,
        price: u64,               // Price in basis points (quote per base)
        quantity: u128,           // Base token (ALEO) quantity in microcredits
        quote_token_id: field,    // Which quote token
        escrow_amount: u128,      // Amount escrowed (ALEO for sell, quote for buy)
        filled: u128,
        created_at: u32,
        expires_at: u32,
    }

    // Receipt record - OWNED BY TRADER (proof of order)
    record Receipt {
        owner: address,           // TRADER
        order_id: field,
        pair_id: u64,
        is_buy: bool,
        price: u64,
        quantity: u128,
        quote_token_id: field,
        escrow_amount: u128,
        created_at: u32,
    }

    // Settlement proof - OWNED BY TRADER (proof of fill)
    record SettlementProof {
        owner: address,           // TRADER
        order_id: field,
        fill_quantity: u128,
        fill_price: u64,
        received_token: field,    // 0field = ALEO, else quote_token_id
        received_amount: u128,
        settled_at: u32,
    }

    // Cancellation request - OWNED BY KEEPER (trader asks to cancel)
    // Trader creates this so keeper can see and process the cancellation
    record CancellationRequest {
        owner: address,           // KEEPER (orchestrator)
        order_id: field,
        trader: address,          // Who requested cancellation
        is_buy: bool,
        created_at: u32,
    }

    // Cancellation proof - OWNED BY TRADER (proof of cancellation)
    // Keeper creates this after processing the cancellation
    record CancellationProof {
        owner: address,           // TRADER
        order_id: field,
        is_buy: bool,             // true = quote token refund, false = ALEO refund
        returned_amount: u128,
        cancelled_at: u32,
    }

    // ========== STRUCTS ==========

    struct TokenPair {
        quote_token_id: field,    // Quote token (USDC, USDT, etc.)
        tick_size: u64,           // Minimum price increment
        is_active: bool,
    }

    struct OrderIdInput {
        caller: address,
        timestamp: u32,
        price: u64,
        quantity: u128,
        is_buy: bool,
        pair_id: u64,
    }

    struct SplitOrderIdInput {
        original_order_id: field,
        remaining_quantity: u128,
    }

    // ========== MAPPINGS ==========

    mapping orchestrator: bool => address;
    mapping keepers: address => bool;
    mapping token_pairs: u64 => TokenPair;
    mapping treasury: bool => address;
    mapping pair_volume: u64 => u128;
    mapping order_counter: bool => u64;

    // ========== CONSTRUCTOR ==========

    @custom
    async constructor() {
        Mapping::set(orchestrator, true, self.program_owner);
        Mapping::set(keepers, self.program_owner, true);
        Mapping::set(treasury, true, self.program_owner);
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

    // Register trading pair: ALEO / quote_token
    // Quote token must exist in token_registry
    async transition register_pair(
        pair_id: u64,
        quote_token_id: field,
        tick_size: u64
    ) -> Future {
        return finalize_register_pair(self.caller, pair_id, quote_token_id, tick_size);
    }

    async function finalize_register_pair(
        caller: address,
        pair_id: u64,
        quote_token_id: field,
        tick_size: u64
    ) {
        let orch: address = Mapping::get(orchestrator, true);
        assert_eq(caller, orch);

        // Note: Token validation happens when transfers are attempted
        // If quote_token_id is invalid, transfer calls will fail

        let pair: TokenPair = TokenPair {
            quote_token_id: quote_token_id,
            tick_size: tick_size,
            is_active: true,
        };
        Mapping::set(token_pairs, pair_id, pair);
        Mapping::set(pair_volume, pair_id, 0u128);
    }

    // ========== ORDER SUBMISSION ==========

    // Submit BUY order - escrow QUOTE TOKEN to buy ALEO
    // Buyer pays quote tokens, receives ALEO on settlement
    async transition submit_buy_order(
        pair_id: u64,
        quote_token_id: field,
        price: u64,
        quantity: u128,            // ALEO quantity to buy (microcredits)
        escrow_quote: u128,        // Quote tokens to escrow
        timestamp: u32,
        expires_at: u32,
        orchestrator_addr: address
    ) -> (Order, Receipt, Future) {
        assert(quantity > 0u128);
        assert(price > 0u64);
        assert(escrow_quote > 0u128);

        let order_id: field = BHP256::hash_to_field(OrderIdInput {
            caller: self.caller,
            timestamp: timestamp,
            price: price,
            quantity: quantity,
            is_buy: true,
            pair_id: pair_id,
        });

        let order: Order = Order {
            owner: orchestrator_addr,
            trader: self.caller,
            order_id: order_id,
            pair_id: pair_id,
            is_buy: true,
            price: price,
            quantity: quantity,
            quote_token_id: quote_token_id,
            escrow_amount: escrow_quote,
            filled: 0u128,
            created_at: timestamp,
            expires_at: expires_at,
        };

        let receipt: Receipt = Receipt {
            owner: self.caller,
            order_id: order_id,
            pair_id: pair_id,
            is_buy: true,
            price: price,
            quantity: quantity,
            quote_token_id: quote_token_id,
            escrow_amount: escrow_quote,
            created_at: timestamp,
        };

        // Escrow quote tokens via token_registry
        let escrow_future: Future = token_registry.aleo/transfer_public_as_signer(
            quote_token_id,
            self.address,
            escrow_quote
        );

        return (order, receipt, finalize_submit_buy_order(
            pair_id,
            quote_token_id,
            price,
            quantity,
            escrow_quote,
            orchestrator_addr,
            escrow_future
        ));
    }

    async function finalize_submit_buy_order(
        pair_id: u64,
        quote_token_id: field,
        price: u64,
        quantity: u128,
        escrow_quote: u128,
        orchestrator_addr: address,
        escrow_future: Future
    ) {
        let expected_orch: address = Mapping::get(orchestrator, true);
        assert_eq(orchestrator_addr, expected_orch);

        let pair: TokenPair = Mapping::get(token_pairs, pair_id);
        assert(pair.is_active);
        assert_eq(pair.quote_token_id, quote_token_id);

        // Verify enough quote escrowed: quantity * price / 10000
        let required: u128 = (quantity * price as u128 + 9999u128) / 10000u128;
        assert(escrow_quote >= required);

        escrow_future.await();

        let counter: u64 = Mapping::get_or_use(order_counter, true, 0u64);
        Mapping::set(order_counter, true, counter + 1u64);
    }

    // Submit SELL order - escrow ALEO to sell for QUOTE TOKEN
    // Seller pays ALEO, receives quote tokens on settlement
    async transition submit_sell_order(
        pair_id: u64,
        quote_token_id: field,
        price: u64,
        quantity: u128,            // ALEO quantity to sell (microcredits)
        escrow_aleo: u64,          // ALEO to escrow (must equal quantity)
        timestamp: u32,
        expires_at: u32,
        orchestrator_addr: address
    ) -> (Order, Receipt, Future) {
        assert(quantity > 0u128);
        assert(price > 0u64);
        assert(escrow_aleo > 0u64);

        let order_id: field = BHP256::hash_to_field(OrderIdInput {
            caller: self.caller,
            timestamp: timestamp,
            price: price,
            quantity: quantity,
            is_buy: false,
            pair_id: pair_id,
        });

        let order: Order = Order {
            owner: orchestrator_addr,
            trader: self.caller,
            order_id: order_id,
            pair_id: pair_id,
            is_buy: false,
            price: price,
            quantity: quantity,
            quote_token_id: quote_token_id,
            escrow_amount: escrow_aleo as u128,
            filled: 0u128,
            created_at: timestamp,
            expires_at: expires_at,
        };

        let receipt: Receipt = Receipt {
            owner: self.caller,
            order_id: order_id,
            pair_id: pair_id,
            is_buy: false,
            price: price,
            quantity: quantity,
            quote_token_id: quote_token_id,
            escrow_amount: escrow_aleo as u128,
            created_at: timestamp,
        };

        // Escrow ALEO via credits.aleo
        let escrow_future: Future = credits.aleo/transfer_public_as_signer(
            self.address,
            escrow_aleo
        );

        return (order, receipt, finalize_submit_sell_order(
            pair_id,
            quote_token_id,
            price,
            quantity,
            escrow_aleo as u128,
            orchestrator_addr,
            escrow_future
        ));
    }

    async function finalize_submit_sell_order(
        pair_id: u64,
        quote_token_id: field,
        price: u64,
        quantity: u128,
        escrow_aleo: u128,
        orchestrator_addr: address,
        escrow_future: Future
    ) {
        let expected_orch: address = Mapping::get(orchestrator, true);
        assert_eq(orchestrator_addr, expected_orch);

        let pair: TokenPair = Mapping::get(token_pairs, pair_id);
        assert(pair.is_active);
        assert_eq(pair.quote_token_id, quote_token_id);

        // Verify seller escrowed exactly the quantity
        assert_eq(escrow_aleo, quantity);

        escrow_future.await();

        let counter: u64 = Mapping::get_or_use(order_counter, true, 0u64);
        Mapping::set(order_counter, true, counter + 1u64);
    }

    // ========== SETTLEMENT ==========

    // Settle matching buy + sell orders (partial or full fill).
    // Returns updated Order records with filled/escrow_amount adjusted.
    // Keeper holds updated records; when filled == quantity the order is fully spent.
    async transition settle_match(
        buy_order: Order,
        sell_order: Order,
        fill_quantity: u128,
        fill_price: u64,
        timestamp: u32,
        treasury_addr: address
    ) -> (Order, Order, SettlementProof, SettlementProof, Future) {
        // Keeper owns both records — enforced by ZK
        assert(buy_order.is_buy);
        assert(!sell_order.is_buy);
        assert_eq(buy_order.pair_id, sell_order.pair_id);
        assert_eq(buy_order.quote_token_id, sell_order.quote_token_id);

        // fill_price must be within the bid-ask spread
        assert(fill_price >= sell_order.price);
        assert(fill_price <= buy_order.price);

        assert(fill_quantity > 0u128);
        assert(fill_quantity <= buy_order.quantity - buy_order.filled);
        assert(fill_quantity <= sell_order.quantity - sell_order.filled);

        let quote_token_id: field = buy_order.quote_token_id;

        // Calculate amounts
        let quote_amount: u128 = (fill_quantity * fill_price as u128) / 10000u128;
        let settler_fee: u128 = (quote_amount * SETTLER_FEE_BPS as u128) / 10000u128;
        let protocol_fee: u128 = (quote_amount * PROTOCOL_FEE_BPS as u128) / 10000u128;
        let seller_receives: u128 = quote_amount - settler_fee - protocol_fee;

        // Escrow safety: payout must not exceed remaining escrow
        assert(quote_amount <= buy_order.escrow_amount);
        assert(fill_quantity <= sell_order.escrow_amount);

        // Updated buy order: filled += fill_quantity, escrow_amount -= quote debited
        let updated_buy: Order = Order {
            owner: buy_order.owner,
            trader: buy_order.trader,
            order_id: buy_order.order_id,
            pair_id: buy_order.pair_id,
            is_buy: buy_order.is_buy,
            price: buy_order.price,
            quantity: buy_order.quantity,
            quote_token_id: buy_order.quote_token_id,
            escrow_amount: buy_order.escrow_amount - quote_amount,
            filled: buy_order.filled + fill_quantity,
            created_at: buy_order.created_at,
            expires_at: buy_order.expires_at,
        };

        // Updated sell order: filled += fill_quantity, escrow_amount -= ALEO paid out
        let updated_sell: Order = Order {
            owner: sell_order.owner,
            trader: sell_order.trader,
            order_id: sell_order.order_id,
            pair_id: sell_order.pair_id,
            is_buy: sell_order.is_buy,
            price: sell_order.price,
            quantity: sell_order.quantity,
            quote_token_id: sell_order.quote_token_id,
            escrow_amount: sell_order.escrow_amount - fill_quantity,
            filled: sell_order.filled + fill_quantity,
            created_at: sell_order.created_at,
            expires_at: sell_order.expires_at,
        };

        // Settlement proofs for traders
        let buyer_proof: SettlementProof = SettlementProof {
            owner: buy_order.trader,
            order_id: buy_order.order_id,
            fill_quantity: fill_quantity,
            fill_price: fill_price,
            received_token: 0field,  // ALEO
            received_amount: fill_quantity,
            settled_at: timestamp,
        };

        let seller_proof: SettlementProof = SettlementProof {
            owner: sell_order.trader,
            order_id: sell_order.order_id,
            fill_quantity: fill_quantity,
            fill_price: fill_price,
            received_token: quote_token_id,
            received_amount: seller_receives,
            settled_at: timestamp,
        };

        // Transfer ALEO to buyer (from seller's escrowed ALEO)
        let pay_buyer: Future = credits.aleo/transfer_public(
            buy_order.trader,
            fill_quantity as u64
        );
        // Transfer quote tokens to seller
        let pay_seller: Future = token_registry.aleo/transfer_public(
            quote_token_id,
            sell_order.trader,
            seller_receives
        );
        // Settler fee to keeper
        let pay_settler: Future = token_registry.aleo/transfer_public(
            quote_token_id,
            self.caller,
            settler_fee
        );
        // Protocol fee to treasury
        let pay_protocol: Future = token_registry.aleo/transfer_public(
            quote_token_id,
            treasury_addr,
            protocol_fee
        );

        return (updated_buy, updated_sell, buyer_proof, seller_proof, finalize_settle_match(
            buy_order.pair_id,
            buy_order.expires_at,
            sell_order.expires_at,
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
        buy_expires_at: u32,
        sell_expires_at: u32,
        fill_quantity: u128,
        quote_amount: u128,
        caller: address,
        treasury_addr: address,
        pay_buyer: Future,
        pay_seller: Future,
        pay_settler: Future,
        pay_protocol: Future
    ) {
        let is_keeper: bool = Mapping::get_or_use(keepers, caller, false);
        assert(is_keeper);

        let expected_treasury: address = Mapping::get(treasury, true);
        assert_eq(treasury_addr, expected_treasury);

        let pair: TokenPair = Mapping::get(token_pairs, pair_id);
        assert(pair.is_active);

        // Both orders must not have expired at settlement time
        assert(block.height <= buy_expires_at);
        assert(block.height <= sell_expires_at);

        pay_buyer.await();
        pay_seller.await();
        pay_settler.await();
        pay_protocol.await();

        let volume: u128 = Mapping::get_or_use(pair_volume, pair_id, 0u128);
        Mapping::set(pair_volume, pair_id, volume + quote_amount);
    }

    // ========== CANCELLATION ==========

    // STEP 1 (TRADER): Request cancellation using your Receipt as proof of order.
    // Creates a CancellationRequest record owned by the keeper so they can see and act on it.
    async transition request_cancel(
        receipt: Receipt,
        keeper_addr: address,
        timestamp: u32
    ) -> (CancellationRequest, Future) {
        // receipt.owner == self.caller is enforced by ZK record ownership

        let cancel_req: CancellationRequest = CancellationRequest {
            owner: keeper_addr,
            order_id: receipt.order_id,
            trader: self.caller,
            is_buy: receipt.is_buy,
            created_at: timestamp,
        };

        return (cancel_req, async {
            let expected_orch: address = Mapping::get(orchestrator, true);
            assert_eq(keeper_addr, expected_orch);
        });
    }

    // STEP 2 (KEEPER): Cancel BUY order - refund quote tokens, give trader a CancellationProof
    async transition cancel_buy_order(
        order: Order,
        cancel_req: CancellationRequest,
        timestamp: u32
    ) -> (CancellationProof, Future) {
        // Keeper owns both records — enforced by ZK
        assert(order.is_buy);
        assert_eq(order.order_id, cancel_req.order_id);
        assert_eq(cancel_req.trader, order.trader);  // refund must go to the order's trader

        // escrow_amount is already reduced by any prior partial fills — refund what remains
        let refund: u128 = order.escrow_amount;
        assert(refund > 0u128);

        let proof: CancellationProof = CancellationProof {
            owner: cancel_req.trader,
            order_id: order.order_id,
            is_buy: true,
            returned_amount: refund,
            cancelled_at: timestamp,
        };

        // Refund quote tokens to trader
        let refund_future: Future = token_registry.aleo/transfer_public(
            order.quote_token_id,
            cancel_req.trader,
            refund
        );

        return (proof, finalize_cancel_order(self.caller, refund_future));
    }

    // STEP 2 (KEEPER): Cancel SELL order - refund ALEO, give trader a CancellationProof
    async transition cancel_sell_order(
        order: Order,
        cancel_req: CancellationRequest,
        timestamp: u32
    ) -> (CancellationProof, Future) {
        // Keeper owns both records — enforced by ZK
        assert(!order.is_buy);
        assert_eq(order.order_id, cancel_req.order_id);
        assert_eq(cancel_req.trader, order.trader);  // refund must go to the order's trader

        // escrow_amount is already reduced by any prior partial fills — refund what remains
        let refund: u128 = order.escrow_amount;
        assert(refund > 0u128);

        let proof: CancellationProof = CancellationProof {
            owner: cancel_req.trader,
            order_id: order.order_id,
            is_buy: false,
            returned_amount: refund,
            cancelled_at: timestamp,
        };

        // Refund ALEO to trader
        let refund_future: Future = credits.aleo/transfer_public(
            cancel_req.trader,
            refund as u64
        );

        return (proof, finalize_cancel_order(self.caller, refund_future));
    }

    async function finalize_cancel_order(caller: address, refund_future: Future) {
        let is_keeper: bool = Mapping::get_or_use(keepers, caller, false);
        assert(is_keeper);
        refund_future.await();
    }

    // ========== SPLIT ORDER ==========

    transition split_order(
        order: Order,
        fill_quantity: u128
    ) -> (Order, Order) {
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
            quote_token_id: order.quote_token_id,
            escrow_amount: fill_escrow,
            filled: 0u128,
            created_at: order.created_at,
            expires_at: order.expires_at,
        };

        let new_order_id: field = BHP256::hash_to_field(SplitOrderIdInput {
            original_order_id: order.order_id,
            remaining_quantity: remaining_quantity,
        });

        let remaining_order: Order = Order {
            owner: self.caller,
            trader: order.trader,
            order_id: new_order_id,
            pair_id: order.pair_id,
            is_buy: order.is_buy,
            price: order.price,
            quantity: remaining_quantity,
            quote_token_id: order.quote_token_id,
            escrow_amount: remaining_escrow,
            filled: 0u128,
            created_at: order.created_at,
            expires_at: order.expires_at,
        };

        return (fill_order, remaining_order);
    }
}
