# Product Requirements Document (PRD)

## 1. Project Overview
**Project Name:** Aleo Advanced Pay - Decentralized Automation Frontend
**Description:** A distinctive, production-grade web application to interface with the Aleo `automation_advanced_transfer_v5.aleo` and `advanced_pay.aleo` smart contracts. The platform allows users to seamlessly schedule one-time transfers, create recurring payments, set up conditional trades based on oracle pricing, and initiate multi-party escrows using native ALEO credits or USDCx.
**Target Audience:** Web3 users, DAO treasuries, crypto businesses, and developers needing trustless, private automation on the Aleo network.
**Aesthetic Vision:** **"Cyber-Industrial Glassmorphism"** - A striking combination of dark, brutalist industrial grids with highly polished, glowing glassmorphic elements. Neon accents (Aleo's signature electric cyan/blue and USDCx deep blue) against a deep, textured dark-mode background. Typography will be monospace and geometric, evoking a high-tech terminal feel but refined for modern web aesthetics. 

## 2. Core Features & Requirements

### 2.1. Wallet & Network Connection
- Connect Aleo wallets (e.g., Leo Wallet, Puzzle) to the frontend.
- Display current network (Testnet), connected address, and balances for both ALEO (Credits) and USDCx.

### 2.2. Dashboard & Task Overview
- View active, executed, and cancelled tasks associated with the connected wallet (read from user's `ReceiptRecord`s).
- Display status of the Keeper Bot (Online/Offline) and current block height.

### 2.3. Task Creation Modules (The Core Actions)
A beautifully designed multi-step creation flow for the four core automation types:
1. **Scheduled Transfer (One-time)**: Input recipient, amount, token type (ALEO/USDCx), keeper fee, trigger block, and expiry block.
2. **Recurring Payment**: Input recipient, amount per execution, interval blocks, max executions, keeper fee, and expiry.
3. **Conditional Transfer**: Input recipient, amount, condition type (>= or <=), target price, oracle address, keeper fee, and expiry.
4. **Multi-Party Escrow**: Input recipient, amount, required approvals, designated party address, keeper fee, and expiry.

### 2.4. Task Management & Execution
- **Cancel/Refund (Escape Hatch)**: A prominent, red-accented button allowing users to unilaterally cancel a task and claim a refund if it hasn't executed, utilizing the `cancel_transfer` or `force_refund` on-chain endpoints.
- **Escrow Approval**: Interface for designated escrow parties to cryptographically sign and approve a pending escrow task.

## 3. User Experience (UX) Flow
1. **Landing / Auth**: User lands on a cinematic dark-mode page with a bold typography headline and a glowing "Connect Aleo Wallet" button.
2. **Main Interface**: A dashboard layout. The left sidebar contains navigation (Dashboard, Create Task, My Receipts, Keeper Network). The main content area uses a bento-box grid style.
3. **Creation Form**: Instead of a boring standard form, task creation uses a dynamic, step-by-step sliding panel. Selecting the "Token" toggles the accent color (Cyan for ALEO, Blue for USDCx).
4. **Transaction Feedback**: Toast notifications with custom animations for "Generating Proof...", "Broadcasting to Network...", and "Success".

## 4. Technical Constraints
- Must interact with the Aleo network via `@provablehq/sdk` (or similar standard Aleo wallet adapter).
- Zero-knowledge proof generation can take time; the UI must gracefully handle loading states with skeleton loaders or engaging animations.
- Must support passing cryptographic signatures for Oracles and Escrow Approvals.

## 5. Out of Scope for v1
- Deploying the Keeper Bot infrastructure from the frontend (the Keeper is assumed to be running off-chain).
- Historical charts/graphs of token prices.