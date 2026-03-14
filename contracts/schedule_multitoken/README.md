# schedule_multitoken.aleo

Scheduled transfer automation supporting native ALEO and any ARC-20 token registered in `token_registry.aleo`.

---

## Design Overview

### Core Principle

No public task mapping. All task data lives in private records. The public `receipt_status` mapping is the only on-chain state — it serves two purposes simultaneously:

1. **Double-spend guard** — prevents both execute and cancel from succeeding on the same task
2. **User-visible status** — user queries `receipt_status[task_id]` to track their task lifecycle

### Record Flow

```
User calls create_*_transfer
        │
        ├─► CancelAuth (user-owned)
        │     └── Consumed by cancel. Proves right to refund.
        │
        ├─► TaskReceipt (user-owned)
        │     └── User's private view of their pending task.
        │         Not consumed — held permanently as proof.
        │
        └─► TaskNotification (keeper-owned)
              └── Discovered by keeper via record scanning.
                  Consumed by execute — cannot execute twice.
```

### Status Lifecycle

```
create  → receipt_status[task_id] = 0u8  (pending)
execute → receipt_status[task_id] = 1u8  (executed)
cancel  → receipt_status[task_id] = 2u8  (cancelled)
```

Execute asserts `status == 0u8`. Cancel asserts `status == 0u8`. Whichever runs first wins — the other fails on-chain. This, combined with Leo's one-time record spend, makes double-spend impossible.

---

## Transitions

### `create_aleo_transfer`

```
inputs:  task_id, recipient, amount (u64), trigger_block, keeper
outputs: CancelAuth (user), TaskReceipt (user), TaskNotification (keeper), Future
```

Escrows native ALEO from signer's public balance. Finalize verifies `keeper == roles[1u8]` and sets `receipt_status[task_id] = 0u8`.

### `execute_aleo_transfer`

```
inputs:  notification: TaskNotification (keeper-owned record)
outputs: Future
```

Keeper passes the record ciphertext directly to snarkos — no manual args needed. Finalize verifies keeper auth, `block.height >= trigger_block`, `status == 0u8`, pays recipient, sets status to `1u8`.

### `cancel_aleo_transfer`

```
inputs:  cancel: CancelAuth (user-owned record)
outputs: Future
```

User calls to reclaim escrowed funds before execution. Finalize asserts `status == 0u8`, refunds, sets status to `2u8`.

Token variants (`create_token_transfer`, `execute_token_transfer`, `cancel_token_transfer`) follow identical logic via `token_registry.aleo`.

---

## Token Support

| token_type | Token | Transfer call | Amount type |
|---|---|---|---|
| `0u8` | Native ALEO | `credits.aleo/transfer_public` | `u64` microcredits |
| `1u8` | Any ARC-20 | `token_registry.aleo/transfer_public` | `u128` base units |

Pass `token_id: 0field` for ALEO transfers. For ARC-20, look up the token's registered ID:
```bash
curl "https://api.explorer.provable.com/v1/testnet/program/token_registry.aleo/mapping/registered_tokens/<token_id>"
```

---

## Keeper Bot

`keeper-multitoken.mjs` uses the Provable record scanner API to discover `TaskNotification` records automatically. No frontend POST registration needed.

**Scanner flow:**
1. Derive view key from `PRIVATE_KEY`
2. Register view key with Provable scanner (once, UUID saved to `.mt-state.json`)
3. Poll for unspent `TaskNotification` records every 30s
4. Decrypt each record to read `trigger_block`, `token_type`, etc.
5. When `block.height >= trigger_block` → call `execute_aleo_transfer` or `execute_token_transfer` passing the **ciphertext** directly (snarkos decrypts during proof generation)
6. Executed task IDs persisted in `.mt-state.json` across restarts

**Execute command (simplified vs old design):**
```bash
snarkos developer execute schedule_multitoken.aleo execute_aleo_transfer "<ciphertext>"
```

No manual public args — all data is in the record, verified on-chain.

---

## Mappings

| Mapping | Key | Value | Purpose |
|---|---|---|---|
| `roles` | `u8` | `address` | `0` = admin, `1` = keeper |
| `receipt_status` | `field` (task_id) | `u8` | Double-spend guard + user status |

---

## Security Properties

| Property | How enforced |
|---|---|
| Only keeper executes | `assert_eq(self.signer, roles.get(1u8))` in finalize |
| No early execution | `assert(block.height >= trigger_block)` in execute finalize |
| No late creation | `assert(trigger_block > block.height)` in create finalize |
| No double execution | `TaskNotification` record consumed (Leo one-time spend) |
| No execute + cancel | `receipt_status == 0u8` asserted by both; first wins |
| No fake notifications | Keeper param verified against `roles[1u8]` in create finalize |
| Only creator cancels | `CancelAuth.owner = creator`; Leo record ownership enforced |

---

## Quick Start

```bash
# Build
cd contracts/schedule_multitoken
leo build

# Deploy
snarkos developer deploy schedule_multitoken.aleo \
  --private-key $PRIVATE_KEY \
  --query https://api.explorer.provable.com/v1 \
  --broadcast https://api.explorer.provable.com/v1/testnet/transaction/broadcast \
  --network 1

# Run keeper bot
cd ../../keeper-bot
npm install
npm run start:multitoken
```

**.env for keeper:**
```
PRIVATE_KEY=APrivateKey1...
PROVABLE_API_KEY=...
PROVABLE_CONSUMER_ID=...
PROGRAM_ID=schedule_multitoken.aleo
```
