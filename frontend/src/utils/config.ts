export const PROGRAM_ID = 'automation_scheduled_transferv3.aleo';

// ── v2 Multitoken ─────────────────────────────────────────────────────────────
export const MT_PROGRAM_ID = 'schedule_multitoken.aleo';

// Keeper wallet address — must match roles[1u8] on-chain.
// Query: https://api.explorer.provable.com/v1/testnet/program/schedule_multitoken.aleo/mapping/roles/1u8
export const KEEPER_ADDRESS = 'aleo1yauy6n5v8h3nhef3s3um0y8l4ejr2su23xayp3l782t0w0yf9u8q7y8twh';

// Known ARC-20 token IDs on testnet (add more as needed)
export const KNOWN_TOKENS: { label: string; tokenId: string; decimals: number }[] = [
  { label: 'test_usdcx', tokenId: '1field', decimals: 6 },
  // Add more: { label: 'wBTC', tokenId: '...field', decimals: 8 },
];

export const MT_BOT_API = 'https://precise-bettina-dabny-2ed5e02e.koyeb.app';
// ──────────────────────────────────────────────────────────────────────────────

export const NETWORK_CONFIG = {
  NETWORK: 'testnet' as const,
  EXPLORER_API: 'https://api.explorer.provable.com/v1/testnet',
  EXPLORER_TX_URL: 'https://testnet.explorer.provable.com/transaction/',
} as const;

// Keeper bot runs locally
export const BOT_API = 'https://precise-bettina-dabny-2ed5e02e.koyeb.app';

// ~10 seconds per block on Aleo testnet
export const SECONDS_PER_BLOCK = 10;
export const BLOCKS_PER_MINUTE = 60 / SECONDS_PER_BLOCK; // 6

// Extra blocks buffer to account for ZK proof generation + confirmation time
export const PROOF_BUFFER_BLOCKS = 20;
