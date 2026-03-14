# Leotask

**Scheduled transfer automation on Aleo.** Users escrow ALEO into an on-chain program; a keeper bot monitors the blockchain and executes the transfer automatically when the trigger block is reached. Cancel anytime before execution for a full refund.

## How It Works

```
User                   On-Chain Program           Keeper Bot
 │                           │                        │
 ├─ create_scheduled_transfer ──────────────────────►  │
 │  (escrows ALEO, sets trigger block)                  │
 │                           │                        │
 │                           │  ◄── polls block ──── │
 │                           │      height every 15s  │
 │                           │                        │
 │           trigger block reached                    │
 │                           │  ◄── execute_scheduled_transfer ─┤
 │                           │      (reads task, pays recipient) │
 │                           │                        │
 ▼                    recipient receives ALEO          │
```

## Repository Structure

```
leotask/
├── src/
│   └── main.leo              # Leo smart contract
├── keeper-bot/
│   ├── keeper-bot.mjs        # Keeper bot (Node.js)
│   ├── create_transfer_test.mjs  # CLI test script
│   └── .env                  # Bot config (private key, endpoints)
├── frontend/
│   └── src/                  # React + Vite UI
└── program.json              # Leo program manifest
```

## Smart Contract

Program: `automation_scheduled_transferv3.aleo`

| Transition | Description |
|---|---|
| `create_scheduled_transfer` | Escrow ALEO, register task on-chain |
| `execute_scheduled_transfer` | Pay recipient (callable by anyone at trigger block) |
| `cancel_scheduled_transfer` | Refund escrowed ALEO to creator |

**Fund flow:** User public credits → program public balance → recipient

## Quick Start

### 1. Keeper Bot

```bash
cd keeper-bot
cp .env.example .env   # set PRIVATE_KEY
npm install
node keeper-bot.mjs
```

Bot runs at `http://localhost:3001`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

Requires Node.js 20+.

### 3. Test via CLI

```bash
cd keeper-bot
node create_transfer_test.mjs
```

Creates a scheduled transfer and registers it with the running bot.

## Keeper Bot API

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Bot status, current block, pending task count |
| `/api/tasks` | GET | All pending tasks with block progress |
| `/api/tasks/register` | POST | Register a task (called automatically by test script / frontend) |

## Configuration

Edit `keeper-bot/.env`:

```env
PRIVATE_KEY=APrivateKey1...   # Keeper wallet private key
PROGRAM_ID=automation_scheduled_transferv3.aleo
NETWORK_ID=1                  # 1 = testnet
API_ENDPOINT=https://api.explorer.provable.com/v1/testnet
QUERY_ENDPOINT=https://api.explorer.provable.com/v1
BROADCAST_ENDPOINT=https://api.explorer.provable.com/v1/testnet/transaction/broadcast
SNARKOS_PATH=snarkos           # path to snarkos binary
BLOCK_INTERVAL=15000           # polling interval in ms
```

## Timing Notes

- Aleo testnet: ~10 seconds per block
- ZK proof generation: 30–120 seconds (~3–12 blocks)
- Minimum useful delay: 5 minutes (30 blocks) to allow proof time
- The frontend adds a 20-block buffer automatically

## Roadmap

### ✅ v1 — Scheduled ALEO Transfer (complete)
- Single ALEO transfer scheduled at a future block
- On-chain escrow via public credits mapping
- Keeper bot auto-execution
- Frontend with Shield + Leo wallet support
- Cancel & refund before execution

### 🚧 v2 — Multi-Token Support (in progress)
- Schedule transfers for any ARC-20 / token-registry token (USDC, USDT, wBTC, etc.)
- Token balance display and approval flow in frontend
- Keeper supports multi-token task execution

### 🔜 v3 — Recurring Payments
- Set a payment cadence (daily, weekly, monthly) and a number of occurrences
- Keeper re-schedules the next execution automatically after each one
- Use case: subscriptions, salaries, vesting schedules, DAO contributor payments

### 🔜 v4 — Recurring Swaps (DCA)
- Dollar-cost averaging: swap a fixed token amount on a recurring schedule
- Integrates with Aleo DEX protocols
- User sets token pair, amount per interval, total duration
- Use case: automated BTC/ETH accumulation strategy

### 🔜 v5 — Price-Triggered Swaps
- Execute a swap when a token reaches a target price (limit order style)
- Oracle integration for on-chain price feeds
- Supports take-profit, stop-loss, and entry orders
- Use case: automated trading without keeping browser open

### 🔜 v6 — Price-Triggered Transfers
- Send tokens to a recipient when a price condition is met
- Combine with recurring logic for conditional payments
- Use case: pay a contractor when asset price is above threshold

### 🔜 v7 — Multi-Step Automation (Workflows)
- Chain multiple actions: swap → transfer → re-invest
- Conditional branching based on on-chain state
- Use case: yield rebalancing, auto-compounding, portfolio management

---

## Requirements

- [snarkOS](https://github.com/AleoHQ/snarkOS) installed
- Node.js 20+ (frontend), Node.js 18+ (keeper bot)
- Public ALEO credits on testnet
- Shield or Leo wallet browser extension (for frontend)
