# Technical Architecture Document

## 1. System Architecture
**Client-Side SPA (Single Page Application)**
- **Framework**: Next.js (App Router) or React (Vite)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Component Library**: shadcn/ui for rapid, accessible, and customizable components.
- **Animations**: Framer Motion for high-impact page transitions, staggered reveals, and micro-interactions.
- **Web3 Integration**: `@provablehq/sdk` for Aleo network interactions, address validation, and proof generation (mocked/wrapped via custom hooks if wallet adapter is unavailable).

## 2. State Management & Data Flow
- **Global State**: React Context or Zustand for Wallet Connection state, User Address, and current Block Height.
- **Local State**: React `useState` and `useReducer` for complex multi-step form state (Task Creation).
- **Data Fetching**: SWR or React Query to poll the Aleo REST API (or a proxy backend) for the latest block height, task statuses (checking `task_status` mapping), and token balances.

## 3. Core Components

### 3.1. Layout & Shell
- `AppShell`: The root layout containing a persistent dark sidebar and top navigation bar. Includes subtle noise textures and animated gradient backgrounds.
- `WalletConnectButton`: A highly stylized button handling the connection to an Aleo wallet extension.

### 3.2. Dashboard Components
- `TaskBentoGrid`: A grid layout displaying metrics: "Active Tasks", "Total Value Locked", "Keeper Status".
- `ReceiptCard`: A glassmorphic card representing a User's `ReceiptRecord`. Displays task type, token (ALEO/USDCx), amount, trigger block, and expiry. Contains an animated "Cancel / Refund" button.

### 3.3. Task Creation Panel
- `TaskTypeSelector`: A segmented control or horizontal list of glowing cards to select the task type (One-Time, Recurring, Conditional, Escrow).
- `TokenSelector`: A toggle between Native ALEO and USDCx. Changes the theme color of the form contextually.
- `TaskForm`: Dynamic inputs based on the selected type:
  - Base inputs: Recipient Address, Amount, Keeper Fee, Expiry Block.
  - Conditional inputs: Target Price, Oracle Address.
  - Recurring inputs: Interval Blocks, Max Executions.
  - Escrow inputs: Required Approvals, Party Address.
- `SubmitTaskButton`: Triggers the Aleo proof generation sequence. Displays a loading overlay with a "Generating ZK Proof" animation.

## 4. Design Guidelines (The Aesthetic)
**"Cyber-Industrial Glassmorphism"**
- **Color Palette**: 
  - Background: `#09090b` (zinc-950) with subtle SVG grain overlays.
  - Primary Accent (ALEO): `#06b6d4` (cyan-500) glowing effects.
  - Secondary Accent (USDCx): `#3b82f6` (blue-500) glowing effects.
  - Borders/Lines: `#27272a` (zinc-800) for a brutalist grid structure.
  - Text: `#fafafa` (zinc-50) for primary, `#a1a1aa` (zinc-400) for secondary.
- **Typography**: 
  - Headings: A sharp, technical geometric sans-serif (e.g., Space Grotesk or a similar Google Font).
  - Monospace: `JetBrains Mono` or `Fira Code` for addresses, block heights, and numeric data.
- **Visual Details**:
  - Cards should have a `backdrop-blur-md` effect with a very subtle, 1px semi-transparent border (`border-white/10`).
  - Hover states should slightly increase the glow (box-shadow) and shift the element up by 2px (`-translate-y-0.5`).
  - The background should feature a very faint, slow-moving radial gradient to prevent the dark mode from feeling "dead".
- **Motion**:
  - Page loads use staggered fade-in-up animations.
  - The transition between Task Types in the creation form should slide smoothly.

## 5. Security & Error Handling
- Validate all Aleo addresses before submission (must start with `aleo1...` and be 63 characters long).
- Validate amounts (must be `> 0`).
- Ensure `expiry_block > trigger_block` (or `first_trigger_block`).
- Display clear, non-technical error messages via toast notifications if the ZK proof fails or the user rejects the transaction.

## 6. Directory Structure (Proposed)
```text
/src
  /app           # Next.js App Router pages (Dashboard, Create, History)
  /components
    /ui          # shadcn/ui generic components (buttons, inputs, dialogs)
    /dashboard   # Bento grid, stat cards
    /tasks       # Task creation forms, Receipt cards
    /layout      # Sidebar, Header, Background effects
  /lib
    /aleo        # Utility functions for `@provablehq/sdk` and network formatting
    /hooks       # useWallet, useBlockHeight, useTasks
    /utils       # cn() for Tailwind class merging
  /styles
    globals.css  # Tailwind imports, CSS variables, and grain animation keyframes
```