#!/usr/bin/env node

/**
 * Nexora Bonded Marketplace — Keeper Bot
 * ============================================================
 * Watches for Order + DeliverySignal + ConfirmationSignal records
 * and calls complete_trade when all three are present.
 *
 * FLOW PER ORDER:
 *   1. Buyer calls purchase_product  → registers Order ciphertext here
 *   2. Seller calls signal_delivery  → registers DeliverySignal ciphertext here
 *   3. Buyer calls signal_confirmation → registers ConfirmationSignal ciphertext here
 *   4. Keeper calls complete_trade (pays seller, updates reputation)
 *
 * Dispute path (buyer-initiated, NOT keeper):
 *   Buyer calls dispute_trade with their DisputeAuth record after timeout.
 *   Keeper only monitors and alerts on approaching timeouts.
 *
 * API:
 *   POST /api/orders/register      — Register order (with optional inline ciphertexts)
 *   POST /api/orders/:id/record    — Push a single record ciphertext
 *   GET  /api/orders               — All orders + status
 *   GET  /health                   — Bot health + current block
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import https from 'https';
import http from 'http';

const SNARKOS = process.env.SNARKOS_PATH || 'snarkos';

const CONFIG = {
  privateKey:        process.env.PRIVATE_KEY || '',
  programId:         process.env.PROGRAM_ID || 'nexora_bonded_marketplace.aleo',
  networkId:         process.env.NETWORK_ID || '1',
  queryEndpoint:     process.env.QUERY_ENDPOINT || 'https://api.explorer.provable.com/v1',
  broadcastEndpoint: process.env.BROADCAST_ENDPOINT || 'https://api.explorer.provable.com/v1/testnet/transaction/broadcast',
  blockIntervalMs:   parseInt(process.env.BLOCK_INTERVAL || '15000'),
  apiPort:           parseInt(process.env.API_PORT || '3002'),
  frontendOrigin:    process.env.FRONTEND_ORIGIN || '*',
  // Warn in logs when an order's timeout is this many blocks away
  timeoutWarnBlocks: parseInt(process.env.TIMEOUT_WARN_BLOCKS || '30'),
};

// ═══════════════════════════════════════════════════════════════
// STATE
// orderStore: Map<orderId, {
//   orderId, sellerId, amount,
//   records: { order, delivery, confirmation },  ← ciphertexts
//   timeoutBlock,  ← block height when buyer can dispute
//   status: 'pending' | 'executing' | 'done' | 'failed',
//   txId, registeredAt
// }>
// ═══════════════════════════════════════════════════════════════

const orderStore = new Map();
let currentBlock = 0n;
let isExecuting  = false;
const botStarted = new Date().toISOString();

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const ts  = () => new Date().toISOString().substring(11, 19);
const log = (t, m) => console.log(`[${ts()}] [${t}] ${m}`);
const err = (t, m) => console.error(`[${ts()}] [${t}] ERROR: ${m}`);

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════
// BLOCK HEIGHT
// ═══════════════════════════════════════════════════════════════

async function fetchBlockHeight() {
  try {
    const raw = await fetchText(`${CONFIG.queryEndpoint}/testnet/block/height/latest`);
    currentBlock = BigInt(raw.trim());
    return currentBlock;
  } catch (e) {
    err('BLOCK', e.message);
    return currentBlock;
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPLETE TRADE
// ═══════════════════════════════════════════════════════════════

// Contract signature:
//   complete_trade(
//     public order_id: field,
//     public seller_id: field,
//     public amount: u64,
//     ord: Order,               ← keeper-owned record
//     delivery: DeliverySignal, ← keeper-owned record
//     confirmation: ConfirmationSignal ← keeper-owned record
//   ) -> Future
//
// Note: seller_address is embedded in the Order record and verified
// on-chain. It is NOT passed as a public argument here.

async function completeTrade(order) {
  const { orderId, sellerId, amount, records } = order;

  log('EXECUTE', `complete_trade for ${orderId}`);
  log('EXECUTE', `  seller_id : ${sellerId}`);
  log('EXECUTE', `  amount    : ${amount} microcredits`);

  const cmd = [
    `${SNARKOS} developer execute`,
    `--private-key "${CONFIG.privateKey}"`,
    `--query "${CONFIG.queryEndpoint}"`,
    `--broadcast "${CONFIG.broadcastEndpoint}"`,
    `--network ${CONFIG.networkId}`,
    CONFIG.programId,
    'complete_trade',
    orderId,            // public order_id: field  (e.g. 123field)
    sellerId,           // public seller_id: field
    `${amount}u64`,     // public amount: u64
    `"${records.order}"`,          // ord: Order
    `"${records.delivery}"`,       // delivery: DeliverySignal
    `"${records.confirmation}"`,   // confirmation: ConfirmationSignal
  ].join(' ');

  try {
    const output = execSync(cmd + ' 2>&1', { timeout: 300000, encoding: 'utf8' });
    const txId = output.match(/at1[a-z0-9]{58}/)?.[0] || 'unknown';
    log('DONE', `Order ${orderId} completed — tx: ${txId}`);
    order.status = 'done';
    order.txId   = txId;
    return true;
  } catch (e) {
    const msg = (e.stdout || '') + (e.stderr || '') || e.message;
    err('EXECUTE', `Order ${orderId} failed: ${msg.substring(0, 400)}`);
    order.status = 'failed';
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// PROCESS LOOP
// ═══════════════════════════════════════════════════════════════

function isReady(order) {
  return order.records.order && order.records.delivery && order.records.confirmation;
}

async function processOrders() {
  if (isExecuting) return;
  isExecuting = true;
  try {
    for (const order of orderStore.values()) {
      if (order.status === 'pending' && isReady(order)) {
        order.status = 'executing';
        await completeTrade(order);
        // Brief pause between executions to avoid nonce conflicts
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  } finally {
    isExecuting = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// BLOCK TICK — poll block height, log status, warn on timeouts
// ═══════════════════════════════════════════════════════════════

async function blockTick() {
  try {
    await fetchBlockHeight();

    const pending  = [...orderStore.values()].filter(o => o.status === 'pending');
    const ready    = pending.filter(isReady);
    const waiting  = pending.filter(o => !isReady(o));

    log('BLOCK', `height: ${currentBlock} | pending: ${pending.length} (${ready.length} ready, ${waiting.length} waiting for signals)`);

    // Warn on orders approaching their dispute timeout
    for (const order of waiting) {
      if (!order.timeoutBlock) continue;
      const blocksLeft = BigInt(order.timeoutBlock) - currentBlock;
      if (blocksLeft >= 0n && blocksLeft <= BigInt(CONFIG.timeoutWarnBlocks)) {
        log('WARN', `Order ${order.orderId} timeout in ${blocksLeft} blocks — missing: ${missingRecords(order).join(', ')}`);
      }
      if (currentBlock > BigInt(order.timeoutBlock)) {
        log('WARN', `Order ${order.orderId} PAST timeout — buyer may dispute. Missing: ${missingRecords(order).join(', ')}`);
      }
    }

    await processOrders();
  } catch (e) {
    err('TICK', e.message);
  }
}

function missingRecords(order) {
  const m = [];
  if (!order.records.order)        m.push('Order');
  if (!order.records.delivery)     m.push('DeliverySignal');
  if (!order.records.confirmation) m.push('ConfirmationSignal');
  return m;
}

// ═══════════════════════════════════════════════════════════════
// SERIALIZATION
// ═══════════════════════════════════════════════════════════════

function serializeOrder(o) {
  return {
    orderId:      o.orderId,
    sellerId:     o.sellerId,
    amount:       o.amount,
    timeoutBlock: o.timeoutBlock || null,
    status:       o.status,
    txId:         o.txId || null,
    records: {
      order:        !!o.records.order,
      delivery:     !!o.records.delivery,
      confirmation: !!o.records.confirmation,
    },
    registeredAt: o.registeredAt,
  };
}

// ═══════════════════════════════════════════════════════════════
// HTTP API
// ═══════════════════════════════════════════════════════════════

function startApiServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', CONFIG.frontendOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url  = new URL(req.url, `http://localhost:${CONFIG.apiPort}`);
    const json = (data, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    };

    // ── POST /api/orders/register ──────────────────────────────────────
    // Called by buyer frontend after purchase_product confirms.
    // Body: {
    //   orderId,           ← field literal e.g. "123field"
    //   sellerId,          ← field literal
    //   amount,            ← number (microcredits)
    //   timeoutBlock?,     ← u32 block height when buyer can dispute
    //   records?: {
    //     order?,          ← Order ciphertext (keeper-owned)
    //     delivery?,       ← DeliverySignal ciphertext (optional at registration)
    //     confirmation?,   ← ConfirmationSignal ciphertext (optional at registration)
    //   }
    // }
    if (req.method === 'POST' && url.pathname === '/api/orders/register') {
      try {
        const body = await readBody(req);
        const { orderId, sellerId, amount } = body;
        if (!orderId || !sellerId || amount == null) {
          return json({ error: 'Required: orderId, sellerId, amount' }, 400);
        }

        if (!orderStore.has(orderId)) {
          orderStore.set(orderId, {
            orderId,
            sellerId,
            amount:       amount.toString(),
            timeoutBlock: body.timeoutBlock ?? null,
            status:       'pending',
            txId:         null,
            records:      { order: null, delivery: null, confirmation: null },
            registeredAt: new Date().toISOString(),
          });
        }

        const order = orderStore.get(orderId);

        // Accept inline ciphertexts if supplied
        if (body.records) {
          if (body.records.order)        order.records.order        = body.records.order;
          if (body.records.delivery)     order.records.delivery     = body.records.delivery;
          if (body.records.confirmation) order.records.confirmation = body.records.confirmation;
        }

        log('REGISTER', `Order ${orderId} | amount: ${amount} | records: order=${!!order.records.order} delivery=${!!order.records.delivery} confirm=${!!order.records.confirmation}`);

        if (isReady(order)) {
          log('REGISTER', 'All 3 records present → executing');
          setTimeout(() => processOrders(), 500);
        }

        return json({ ok: true, order: serializeOrder(order) });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }

    // ── POST /api/orders/:id/record ────────────────────────────────────
    // Called individually as each signal is created on-chain.
    // Body: { type: "order" | "delivery" | "confirmation", ciphertext: "..." }
    const recordMatch = url.pathname.match(/^\/api\/orders\/(.+?)\/record$/);
    if (req.method === 'POST' && recordMatch) {
      try {
        const orderId = decodeURIComponent(recordMatch[1]);
        const body    = await readBody(req);
        const { type, ciphertext } = body;

        if (!['order', 'delivery', 'confirmation'].includes(type) || !ciphertext) {
          return json({ error: 'Required: type (order|delivery|confirmation), ciphertext' }, 400);
        }
        if (!orderStore.has(orderId)) return json({ error: 'Order not found' }, 404);

        const order = orderStore.get(orderId);
        if (order.status !== 'pending') {
          return json({ error: `Order status is ${order.status}, cannot update records` }, 400);
        }

        order.records[type] = ciphertext;
        log('RECORD', `Order ${orderId}: ${type} received`);

        if (isReady(order)) {
          log('RECORD', 'All 3 records now present → executing');
          setTimeout(() => processOrders(), 500);
        }

        return json({ ok: true, order: serializeOrder(order) });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }

    // ── GET /api/orders ────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const orders = [...orderStore.values()].map(serializeOrder);
      return json({ orders, currentBlock: currentBlock.toString() });
    }

    // ── GET /health ────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/health') {
      const all     = [...orderStore.values()];
      const pending = all.filter(o => o.status === 'pending');
      return json({
        status:         'ok',
        programId:      CONFIG.programId,
        currentBlock:   currentBlock.toString(),
        orders: {
          total:    all.length,
          pending:  pending.length,
          ready:    pending.filter(isReady).length,
          waiting:  pending.filter(o => !isReady(o)).length,
          done:     all.filter(o => o.status === 'done').length,
          failed:   all.filter(o => o.status === 'failed').length,
        },
        upSince: botStarted,
      });
    }

    res.writeHead(404); res.end();
  });

  server.listen(CONFIG.apiPort, () => {
    log('API', `Listening on :${CONFIG.apiPort}`);
    log('API', `  POST /api/orders/register`);
    log('API', `  POST /api/orders/:id/record`);
    log('API', `  GET  /api/orders`);
    log('API', `  GET  /health`);
  });
  server.on('error', e => err('API', e.message));
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          Nexora Marketplace — Keeper Bot                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  log('BOT', `Program : ${CONFIG.programId}`);
  log('BOT', `Network : ${CONFIG.networkId}`);
  log('BOT', `Polling : every ${CONFIG.blockIntervalMs / 1000}s`);
  console.log('');

  if (!CONFIG.privateKey) { err('BOT', 'PRIVATE_KEY not set in .env'); process.exit(1); }

  startApiServer();

  log('BOT', 'Fetching initial block height...');
  await blockTick();

  setInterval(blockTick, CONFIG.blockIntervalMs);
  log('BOT', 'Running. POST /api/orders/register to queue orders.');
}

main().catch(e => { err('FATAL', e.message); process.exit(1); });
