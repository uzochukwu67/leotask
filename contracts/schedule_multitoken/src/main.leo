// schedule_multitoken.aleo
//
// Scheduled transfer automation supporting:
//   token_type 0 — Native ALEO via credits.aleo           (amounts: microcredits u64)
//   token_type 1 — Any ARC-20 token via token_registry.aleo (amounts: u128, id: field)
//
// Record flow:
//   create  → TaskReceipt (user-owned) + TaskNotification (keeper-owned)
//   execute → keeper consumes TaskNotification, sets receipt_status = 1u8
//   cancel  → user consumes CancelAuth, sets receipt_status = 2u8
//
// receipt_status double-spend guard:
//   0u8 = pending   (set on create)
//   1u8 = executed  (set on execute)
//   2u8 = cancelled (set on cancel)
//   Execute and cancel both assert status == 0u8, so only one can succeed.

import credits.aleo;
import token_registry.aleo;

program schedule_multitoken.aleo {

    // ─── Mappings ────────────────────────────────────────────────────────────

    mapping roles: u8 => address;
    // 0 = admin, 1 = keeper

    // task_id => 0u8 pending | 1u8 executed | 2u8 cancelled
    // Set to 0u8 on create. Acts as double-spend guard and user-visible status.
    // Persists after execution/cancellation so users can query their task history.
    mapping receipt_status: field => u8;

    // ─── Records ─────────────────────────────────────────────────────────────

    // Owned by the creator. Proves the task exists and allows cancellation.
    record CancelAuth {
        owner:      address,
        task_id:    field,
        amount:     u128,
        token_type: u8,
        token_id:   field,
    }

    // Owned by the creator. Shows full task details so user can see their pending task.
    record TaskReceipt {
        owner:         address,
        task_id:       field,
        recipient:     address,
        amount:        u128,
        trigger_block: u32,
        token_type:    u8,
        token_id:      field,
    }

    // Owned by the keeper. Discovered via record scanning.
    // Consumed by execute_*_transfer — cannot be executed twice.
    record TaskNotification {
        owner:         address,   // keeper wallet
        task_id:       field,
        recipient:     address,
        amount:        u128,
        trigger_block: u32,
        token_type:    u8,
        token_id:      field,     // 0field when token_type == 0
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    @custom
    async constructor() {
        let deployer: address = self.program_owner;
        roles.set(0u8, deployer);
        roles.set(1u8, deployer);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NATIVE ALEO (credits.aleo)
    // ═══════════════════════════════════════════════════════════════════════

    async transition create_aleo_transfer(
        public task_id:       field,
        public recipient:     address,
        public amount:        u64,
        public trigger_block: u32,
        public keeper:        address,
    ) -> (CancelAuth, TaskReceipt, TaskNotification, Future) {
        let escrow: Future = credits.aleo/transfer_public_as_signer(self.address, amount);
        let creator: address = self.signer;

        let cancel: CancelAuth = CancelAuth {
            owner:      creator,
            task_id:    task_id,
            amount:     amount as u128,
            token_type: 0u8,
            token_id:   0field,
        };
        let receipt: TaskReceipt = TaskReceipt {
            owner:         creator,
            task_id:       task_id,
            recipient:     recipient,
            amount:        amount as u128,
            trigger_block: trigger_block,
            token_type:    0u8,
            token_id:      0field,
        };
        let notification: TaskNotification = TaskNotification {
            owner:         keeper,
            task_id:       task_id,
            recipient:     recipient,
            amount:        amount as u128,
            trigger_block: trigger_block,
            token_type:    0u8,
            token_id:      0field,
        };

        return (cancel, receipt, notification, async {
            let registered_keeper: address = roles.get(1u8);
            assert_eq(keeper, registered_keeper);
            assert(trigger_block > block.height);
            assert(!receipt_status.contains(task_id));
            escrow.await();
            receipt_status.set(task_id, 0u8);
        });
    }

    // Keeper consumes the TaskNotification record (can only happen once).
    // Finalize checks status == 0u8 so cancel cannot also succeed.
    async transition execute_aleo_transfer(
        notification: TaskNotification,
    ) -> Future {
        let keeper: address = self.signer;
        let pay: Future = credits.aleo/transfer_public(notification.recipient, notification.amount as u64);
        let task_id: field = notification.task_id;
        let trigger_block: u32 = notification.trigger_block;

        return async {
            let registered_keeper: address = roles.get(1u8);
            assert_eq(keeper, registered_keeper);
            assert(block.height >= trigger_block);
            let status: u8 = receipt_status.get(task_id);
            assert_eq(status, 0u8);
            pay.await();
            receipt_status.set(task_id, 1u8);
        };
    }

    // Creator consumes CancelAuth (can only happen once).
    // Finalize checks status == 0u8 so execute cannot also succeed.
    async transition cancel_aleo_transfer(
        cancel: CancelAuth,
    ) -> Future {
        assert_eq(cancel.token_type, 0u8);
        let owner: address = cancel.owner;
        let refund: Future = credits.aleo/transfer_public(owner, cancel.amount as u64);
        let task_id: field = cancel.task_id;
        let amount: u128 = cancel.amount;

        return async {
            let status: u8 = receipt_status.get(task_id);
            assert_eq(status, 0u8);
            refund.await();
            receipt_status.set(task_id, 2u8);
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ARC-20 TOKEN (token_registry.aleo)
    // ═══════════════════════════════════════════════════════════════════════

    async transition create_token_transfer(
        public task_id:       field,
        public recipient:     address,
        public amount:        u128,
        public trigger_block: u32,
        public token_id:      field,
        public keeper:        address,
    ) -> (CancelAuth, TaskReceipt, TaskNotification, Future) {
        let escrow: Future = token_registry.aleo/transfer_public_as_signer(token_id, self.address, amount);
        let creator: address = self.signer;

        let cancel: CancelAuth = CancelAuth {
            owner:      creator,
            task_id:    task_id,
            amount:     amount,
            token_type: 1u8,
            token_id:   token_id,
        };
        let receipt: TaskReceipt = TaskReceipt {
            owner:         creator,
            task_id:       task_id,
            recipient:     recipient,
            amount:        amount,
            trigger_block: trigger_block,
            token_type:    1u8,
            token_id:      token_id,
        };
        let notification: TaskNotification = TaskNotification {
            owner:         keeper,
            task_id:       task_id,
            recipient:     recipient,
            amount:        amount,
            trigger_block: trigger_block,
            token_type:    1u8,
            token_id:      token_id,
        };

        return (cancel, receipt, notification, async {
            let registered_keeper: address = roles.get(1u8);
            assert_eq(keeper, registered_keeper);
            assert(trigger_block > block.height);
            assert(!receipt_status.contains(task_id));
            escrow.await();
            receipt_status.set(task_id, 0u8);
        });
    }

    async transition execute_token_transfer(
        notification: TaskNotification,
    ) -> Future {
        let keeper: address = self.signer;
        let pay: Future = token_registry.aleo/transfer_public(
            notification.token_id,
            notification.recipient,
            notification.amount,
        );
        let task_id: field = notification.task_id;
        let trigger_block: u32 = notification.trigger_block;

        return async {
            let registered_keeper: address = roles.get(1u8);
            assert_eq(keeper, registered_keeper);
            assert(block.height >= trigger_block);
            let status: u8 = receipt_status.get(task_id);
            assert_eq(status, 0u8);
            pay.await();
            receipt_status.set(task_id, 1u8);
        };
    }

    async transition cancel_token_transfer(
        cancel: CancelAuth,
    ) -> Future {
        assert_eq(cancel.token_type, 1u8);
        let owner: address = cancel.owner;
        let token_id: field = cancel.token_id;
        let amount: u128 = cancel.amount;
        let task_id: field = cancel.task_id;
        let refund: Future = token_registry.aleo/transfer_public(token_id, owner, amount);

        return async {
            let status: u8 = receipt_status.get(task_id);
            assert_eq(status, 0u8);
            refund.await();
            receipt_status.set(task_id, 2u8);
        };
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    async transition set_keeper(public new_keeper: address) -> Future {
        let caller: address = self.signer;
        return async {
            let admin: address = roles.get(0u8);
            assert_eq(caller, admin);
            roles.set(1u8, new_keeper);
        };
    }
}
