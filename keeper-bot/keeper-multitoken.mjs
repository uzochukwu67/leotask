#!/usr/bin/env node

/**
 * Leotask Multitoken — Keeper Bot (Record Scanner)
 * =================================================
 * Discovers tasks automatically by scanning for keeper-owned
 * TaskNotification records. No frontend POST required.
 *
 * FLOW:
 *   1. Derive view key from PRIVATE_KEY
 *   2. Register view key with Provable scanner (once, saved to .mt-state.json)
 *   3. Poll scanner for unspent TaskNotification records
 *   4. Decrypt each → extract task_id, recipient, amount, trigger_block, token_type, token_id
 *   5. When block.height >= trigger_block → call execute_aleo_transfer or execute_token_transfer
 *
 * ENV (.env):
 *   PRIVATE_KEY            — keeper wallet private key (required)
 *   PROVABLE_API_KEY       — raw API key from POST /consumers (required)
 *   PROVABLE_CONSUMER_ID   — consumer.id from POST /consumers (required)
 *   PROVABLE_UUID          — scanner UUID; auto-registered on first run
 *   PROGRAM_ID             — defaults to schedule_multitoken.aleo
 *   SNARKOS_PATH           — path to snarkos binary (default: snarkos)
 *   QUERY_ENDPOINT         — Aleo explorer API base URL
 *   BROADCAST_ENDPOINT     — Aleo broadcast endpoint
 *   NETWORK_ID             — network ID (default: 1)
 *   SCAN_INTERVAL_MS       — how often to scan (default: 30000)
 *   API_PORT               — HTTP status API port (default: 3003)
 *
 * INSTALL SDK:
 *   npm install @provablehq/sdk
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Account } from '@provablehq/sdk/testnet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.mt-state.json');
const SNARKOS = process.env.SNARKOS_PATH || 'snarkos';

const CONFIG = {
  privateKey:         process.env.PRIVATE_KEY || '',
  provableApiKey:     process.env.PROVABLE_API_KEY || '',
  provableConsumerId: process.env.PROVABLE_CONSUMER_ID || '',
  provableUuid:       process.env.PROVABLE_UUID || '',
  programId:          process.env.MT_PROGRAM_ID || 'schedule_multitoken.aleo',
  networkId:          process.env.NETWORK_ID || '1',
  queryEndpoint:      process.env.QUERY_ENDPOINT || 'https://api.explorer.provable.com/v1',
  broadcastEndpoint:  process.env.BROADCAST_ENDPOINT || 'https://api.explorer.provable.com/v1/testnet/transaction/broadcast',
  scanIntervalMs:     parseInt(process.env.SCAN_INTERVAL_MS || '30000'),
  apiPort:            parseInt(process.env.API_PORT || '3003'),
  provableBase:       'https://api.provable.com',
  scannerBase:        'https://api.provable.com/scanner/testnet',
};

// ═══════════════════════════════════════════════════════════════
// STATE
// taskStore: Map<taskId, {
//   taskId, recipient, amount, triggerBlock, tokenType, tokenId,
//   status: 'pending' | 'executing' | 'done' | 'failed',
//   txId, discoveredAt
// }>
// executedIds: Set<string> — persisted across restarts
// ═══════════════════════════════════════════════════════════════

const taskStore   = new Map();
const executedIds = new Set();   // survived restarts via STATE_FILE
const userUuids   = new Map();   // viewKey → uuid, survived restarts via STATE_FILE
let currentBlock  = 0n;
let isExecuting   = false;
let scannerReady  = false;
let apiJwt        = '';
let scannerUuid   = CONFIG.provableUuid;
let keeperAccount = null;
const botStarted  = new Date().toISOString();

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const ts  = () => new Date().toISOString().substring(11, 19);
const log = (t, m) => console.log(`[${ts()}] [${t}] ${m}`);
const err = (t, m) => console.error(`[${ts()}] [${t}] ERROR: ${m}`);

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (!scannerUuid && s.uuid) scannerUuid = s.uuid;
      if (Array.isArray(s.executedIds)) s.executedIds.forEach(id => executedIds.add(id));
      if (s.userUuids) Object.entries(s.userUuids).forEach(([vk, uid]) => userUuids.set(vk, uid));
    }
  } catch { /* ignore */ }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      uuid:       scannerUuid,
      executedIds: [...executedIds],
      userUuids:  Object.fromEntries(userUuids),
    }, null, 2));
  } catch { /* ignore */ }
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body } = opts;
    const parsed = new URL(url);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function fetchWithHeaders(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body } = opts;
    const parsed = new URL(url);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers: { Accept: 'application/json', ...headers },
    };
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let json; try { json = JSON.parse(data); } catch { json = data; }
        resolve({ json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════
// RECORD PLAINTEXT PARSER
// Leo plaintext format: { field_name: value.private, ... }
// Strips .private / .public visibility suffixes from values.
// ═══════════════════════════════════════════════════════════════

function parsePlaintext(text) {
  if (!text) return {};
  const result = {};
  const re = /(\w+)\s*:\s*([^,}\s]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    result[m[1]] = m[2].replace(/\.(private|public)$/, '');
  }
  return result;
}

// Strip Leo type suffix: "123u128" → "123", "456field" kept as-is for snarkos
function numVal(val) { return val ? val.replace(/[a-z][a-z0-9]*$/, '') : '0'; }

// ═══════════════════════════════════════════════════════════════
// BLOCK HEIGHT
// ═══════════════════════════════════════════════════════════════

async function fetchBlockHeight() {
  try {
    const raw = await fetchJson(`${CONFIG.queryEndpoint}/testnet/block/height/latest`);
    currentBlock = BigInt(typeof raw === 'number' ? raw : String(raw).trim());
  } catch (e) {
    err('BLOCK', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// PROVABLE AUTH
// ═══════════════════════════════════════════════════════════════

async function issueJwt() {
  log('AUTH', 'Requesting JWT...');
  const { json, headers } = await fetchWithHeaders(
    `${CONFIG.provableBase}/jwts/${CONFIG.provableConsumerId}`,
    { method: 'POST', headers: { 'X-Provable-API-Key': CONFIG.provableApiKey } },
  );
  const token = headers['authorization'] || headers['x-provable-jwt'] || headers['x-jwt'] || headers['token'];
  if (!token) throw new Error(`JWT not found in response headers. Body: ${JSON.stringify(json)}`);
  apiJwt = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  log('AUTH', `JWT issued (exp: ${json?.exp ?? 'unknown'})`);
}

// ═══════════════════════════════════════════════════════════════
// PROVABLE SCANNER — REGISTER VIEW KEY (first run)
// ═══════════════════════════════════════════════════════════════

async function ensureUuid(viewKey) {
  if (scannerUuid) { log('SCANNER', `UUID: ${scannerUuid}`); return; }
  // Start from SCAN_START_BLOCK env var if set, otherwise 20000 blocks back.
  const startBlock = process.env.SCAN_START_BLOCK
    ? parseInt(process.env.SCAN_START_BLOCK)
    : Math.max(0, Number(currentBlock) - 20000);
  log('SCANNER', `Registering view key (start=${startBlock})...`);
  const res = await fetchJson(`${CONFIG.scannerBase}/register`, {
    method: 'POST',
    headers: { Authorization: apiJwt },
    body: { view_key: viewKey, start: startBlock },
  });
  if (!res?.uuid) throw new Error(`Scanner registration failed: ${JSON.stringify(res)}`);
  scannerUuid = res.uuid;
  log('SCANNER', `UUID: ${scannerUuid} — saved to ${STATE_FILE}`);
  saveState();
}

// ═══════════════════════════════════════════════════════════════
// PROVABLE SCANNER — FETCH TaskNotification RECORDS
// ═══════════════════════════════════════════════════════════════

async function fetchTaskNotifications() {
  const body = {
    uuid:    scannerUuid.trim(),
    decrypt: true,
    unspent: true,   // false = include spent so we can see all records for debugging
    filter: {
      programs: [CONFIG.programId],
      records:  ['TaskNotification'],
      "functions": [
      "create_aleo_transfer",
      "create_token_transfer"
    ],
    },
    response_filter: {
      record_ciphertext: true,
      record_name:       true,
      record_plaintext:  true,
      transaction_id:    true,
      block_height:      true,
      spent:             true,
    },
  };

  // console.log('[DEBUG] Scanner request body:', JSON.stringify(body, null, 2));

  const res = await fetchJson(`${CONFIG.scannerBase}/records/owned`, {
    method: 'POST',
    headers: { Authorization: apiJwt },
    body,
  });

  
  if (!Array.isArray(res)) {
    err('SCANNER', `Unexpected response: ${JSON.stringify(res).substring(0, 200)}`);
    return [];
  }
  return res;
}

// ═══════════════════════════════════════════════════════════════
// EXECUTE TRANSITIONS
//
// Contract signatures (new design — record consumed by keeper):
//   execute_aleo_transfer(notification: TaskNotification) -> Future
//   execute_token_transfer(notification: TaskNotification) -> Future
//
// The ciphertext is passed directly; snarkos decrypts it during
// proof generation using the keeper's private key. No public args
// needed — all data (recipient, amount, trigger_block) lives in
// the record, verified on-chain by the finalize.
// ═══════════════════════════════════════════════════════════════

async function getOnChainStatus(taskId) {
  try {
    const url = `${CONFIG.queryEndpoint}/testnet/program/${CONFIG.programId}/mapping/receipt_status/${taskId}`;
    const res = await fetch(url, { headers: { Authorization: apiJwt } });
    if (!res.ok) return null;
    const text = await res.text();
    // Response is a quoted string like "1u8" or null
    const val = text.trim().replace(/"/g, '').replace(/u8$/, '');
    return val === 'null' ? null : parseInt(val, 10);
  } catch { return null; }
}

async function executeTask(task) {
  const label      = task.tokenType === '0' ? 'ALEO' : `token:${task.tokenId}`;
  const transition = task.tokenType === '0' ? 'execute_aleo_transfer' : 'execute_token_transfer';

  // Check on-chain status first — guard against stale scanner / failed-but-broadcast txs
  const onChainStatus = await getOnChainStatus(task.taskId);
  if (onChainStatus === 1 || onChainStatus === 2) {
    log('SKIP', `Task ${task.taskId} already settled on-chain (status=${onChainStatus})`);
    task.status = 'done';
    executedIds.add(task.taskId);
    saveState();
    return;
  }

  log('EXECUTE', `task ${task.taskId} | ${label} | amount: ${task.amount} | block: ${currentBlock} >= ${task.triggerBlock}`);

  task.status = 'executing';
  try {
    // Debug: Log what we're passing to snarkos
    console.log('[DEBUG] plaintext being passed:', task.plaintext?.substring(0, 200));
    console.log('[DEBUG] tokenType:', task.tokenType, '| transition:', transition);
    
    const cmd = [
      `${SNARKOS} developer execute`,
      `--private-key "${CONFIG.privateKey}"`,
      `--endpoint "${CONFIG.queryEndpoint}"`,
      `--broadcast "${CONFIG.broadcastEndpoint}"`,
      `--network ${CONFIG.networkId}`,
      CONFIG.programId,
      transition,
      `"${task.plaintext}"`,   // notification: TaskNotification (plaintext, not ciphertext)
    ].join(' ');

    console.log('[DEBUG] snarkos cmd:', cmd.substring(0, 500) + '...');
    
    const output = execSync(cmd + ' 2>&1', { timeout: 300000, encoding: 'utf8' });
    const txId   = output.match(/at1[a-z0-9]{58}/)?.[0] || 'unknown';
    log('DONE', `Task ${task.taskId} executed — tx: ${txId}`);
    task.status = 'done';
    task.txId   = txId;
    executedIds.add(task.taskId);
    saveState();
  } catch (e) {
    const msg = (e.stdout || '') + (e.stderr || '') || e.message;
    err('EXECUTE', `Task ${task.taskId} failed: ${msg.substring(0, 400)}`);
    task.status = 'failed';
  }
}

// ═══════════════════════════════════════════════════════════════
// SCAN + PROCESS LOOP
// ═══════════════════════════════════════════════════════════════

async function scanAndProcess() {
  if (isExecuting) return;
  isExecuting = true;

  try {
    await fetchBlockHeight();
    log('SCAN', `block=${currentBlock} — fetching TaskNotification records...`);

    const rawRecords = await fetchTaskNotifications();
    log('SCAN', `Scanner returned ${rawRecords.length} unspent TaskNotification(s)`);

    for (const rec of rawRecords) {
      // Decrypt ciphertext using keeper's private key via SDK
      let plaintextStr;
      try {
        const decrypted = keeperAccount.decryptRecord(rec.record_ciphertext);
        plaintextStr = decrypted.toString();
      } catch (e) {
        err('DECRYPT', `Failed on ${rec.record_ciphertext?.substring(0, 40)}: ${e.message}`);
        continue;
      }
      console.log('[DEBUG] record plaintext:', plaintextStr.substring(0, 300));

      const plain  = parsePlaintext(plaintextStr || '');
      const taskId = plain.task_id;
      console.log('[DEBUG] parsed fields:', JSON.stringify(plain));
      if (!taskId) { err('PARSE', `No task_id in: ${plaintextStr}`); continue; }

      // Skip already executed tasks (persisted across restarts)
      if (executedIds.has(taskId)) continue;

      // Upsert into taskStore
      if (!taskStore.has(taskId)) {
        taskStore.set(taskId, {
          taskId,
          recipient:    plain.recipient    || '',
          amount:       numVal(plain.amount),
          triggerBlock: plain.trigger_block ? numVal(plain.trigger_block) : '0',
          tokenType:    plain.token_type   ? numVal(plain.token_type)    : '0',
          tokenId:      plain.token_id     || '0field',
          plaintext:    plaintextStr.replace(/\s+/g, ' ').trim(),  // single-line for snarkos CLI
          status:       'pending',
          txId:         null,
          discoveredAt: new Date().toISOString(),
        });
        log('FOUND', `Task ${taskId} | token_type=${plain.token_type} | trigger_block=${plain.trigger_block}`);
      }

      const task = taskStore.get(taskId);
      if (task.status !== 'pending') continue;

      const triggerBlock = BigInt(task.triggerBlock);
      if (currentBlock >= triggerBlock) {
        await executeTask(task);
        await new Promise(r => setTimeout(r, 5000)); // pause between executions
      } else {
        const blocksLeft = triggerBlock - currentBlock;
        log('WAIT', `Task ${taskId} — ${blocksLeft} block(s) remaining (~${Math.ceil(Number(blocksLeft) * 10 / 60)}m)`);
      }
    }

    // Summary
    const all     = [...taskStore.values()];
    const pending = all.filter(t => t.status === 'pending');
    log('SCAN', `store: ${all.length} total | ${pending.length} pending | ${all.filter(t => t.status === 'done').length} done`);
  } catch (e) {
    err('SCAN', e.message);
  } finally {
    isExecuting = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// READ-ONLY HTTP STATUS API
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// USER RECORD SCAN  (TaskReceipt + CancelAuth)
// Called by POST /api/scan  { view_key, start_block? }
// Registers the view key with the Provable scanner on first call,
// then returns all decrypted records owned by that key.
// ═══════════════════════════════════════════════════════════════

async function scanUserRecords(viewKey, startBlock) {
  // 1. Get or register UUID for this view key
  let uuid = userUuids.get(viewKey);
  if (!uuid) {
    const start = startBlock ?? (process.env.SCAN_START_BLOCK
      ? parseInt(process.env.SCAN_START_BLOCK)
      : Math.max(0, Number(currentBlock) - 20000));
    log('SCAN-USER', `Registering view key (start=${start})...`);
    const res = await fetchJson(`${CONFIG.scannerBase}/register`, {
      method: 'POST',
      headers: { Authorization: apiJwt },
      body: { view_key: viewKey, start },
    });
    if (!res?.uuid) throw new Error(`Scanner registration failed: ${JSON.stringify(res)}`);
    uuid = res.uuid;
    userUuids.set(viewKey, uuid);
    saveState();
    log('SCAN-USER', `UUID registered: ${uuid}`);
  }

  // 2. Query for TaskReceipt and CancelAuth records
  const body = {
    uuid,
    decrypt: true,
    unspent: false,   // include spent so users see full history
    filter: {
      programs: [CONFIG.programId],
      records:  ['TaskReceipt', 'CancelAuth'],
      functions: ['create_aleo_transfer', 'create_token_transfer'],
    },
    response_filter: {
      record_ciphertext: true,
      record_name:       true,
      record_plaintext:  true,
      transaction_id:    true,
      block_height:      true,
      spent:             true,
    },
  };

  const raw = await fetchJson(`${CONFIG.scannerBase}/records/owned`, {
    method: 'POST',
    headers: { Authorization: apiJwt },
    body,
  });

  if (!Array.isArray(raw)) throw new Error(`Unexpected scanner response: ${JSON.stringify(raw).substring(0, 200)}`);

  // 3. Decrypt each record using the user's view key via SDK
  let userAccount;
  try { userAccount = new Account({ viewKey }); } catch (e) {
    throw new Error(`Invalid view key: ${e.message}`);
  }

  const receipts = [];
  const cancels  = [];

  for (const rec of raw) {
    let plaintext = {};
    try {
      const decrypted = userAccount.decryptRecord(rec.record_ciphertext);
      plaintext = parsePlaintext(decrypted.toString());
    } catch { /* skip undecryptable */ }

    const entry = {
      record_name:    rec.record_name,
      transaction_id: rec.transaction_id,
      block_height:   rec.block_height,
      spent:          rec.spent,
      fields:         plaintext,
    };

    if (rec.record_name === 'TaskReceipt') receipts.push(entry);
    else if (rec.record_name === 'CancelAuth') cancels.push(entry);
  }

  return { uuid, receipts, cancels };
}

function startApiServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url  = new URL(req.url, `http://localhost:${CONFIG.apiPort}`);
    const json = (data, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    };

    // GET /api/tasks
    if (req.method === 'GET' && url.pathname === '/api/tasks') {
      return json({
        tasks:        [...taskStore.values()],
        currentBlock: currentBlock.toString(),
        scannerReady,
      });
    }

    // GET /api/tasks/:id
    const taskMatch = url.pathname.match(/^\/api\/tasks\/(.+)$/);
    if (req.method === 'GET' && taskMatch) {
      const task = taskStore.get(decodeURIComponent(taskMatch[1]));
      if (!task) return json({ error: 'Not found' }, 404);
      return json(task);
    }

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      const all     = [...taskStore.values()];
      const pending = all.filter(t => t.status === 'pending');
      return json({
        status:       scannerReady ? 'ok' : 'initializing',
        programId:    CONFIG.programId,
        currentBlock: currentBlock.toString(),
        scannerUuid:  scannerUuid || null,
        scannerReady,
        tasks: {
          total:   all.length,
          pending: pending.length,
          ready:   pending.filter(t => currentBlock >= BigInt(t.triggerBlock)).length,
          done:    all.filter(t => t.status === 'done').length,
          failed:  all.filter(t => t.status === 'failed').length,
        },
        upSince: botStarted,
      });
    }

    // POST /api/scan  — decrypt user's TaskReceipt + CancelAuth records
    if (req.method === 'POST' && url.pathname === '/api/scan') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', async () => {
        try {
          const { view_key, start_block } = JSON.parse(body);
          if (!view_key) return json({ error: 'view_key required' }, 400);
          if (!scannerReady) return json({ error: 'Scanner not ready yet' }, 503);
          const result = await scanUserRecords(view_key, start_block);
          return json(result);
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      });
      return;
    }

    res.writeHead(404); res.end();
  });

  server.listen(CONFIG.apiPort, () => {
    log('API', `Listening on :${CONFIG.apiPort}`);
    log('API', `  GET  /api/tasks`);
    log('API', `  GET  /api/tasks/:id`);
    log('API', `  GET  /health`);
    log('API', `  POST /api/scan  { view_key, start_block? }`);
  });
  server.on('error', e => err('API', e.message));
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║     Leotask Multitoken — Keeper Bot (Record Scanner)      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  if (!CONFIG.privateKey)         { err('BOT', 'PRIVATE_KEY not set'); process.exit(1); }
  if (!CONFIG.provableApiKey)     { err('BOT', 'PROVABLE_API_KEY not set'); process.exit(1); }
  if (!CONFIG.provableConsumerId) { err('BOT', 'PROVABLE_CONSUMER_ID not set'); process.exit(1); }

  keeperAccount = new Account({ privateKey: CONFIG.privateKey });
  const viewKeyObj = keeperAccount.viewKey();
  // @provablehq/sdk WASM objects use to_string(), not JS .toString()
  const viewKey = typeof viewKeyObj.to_string === 'function'
    ? viewKeyObj.to_string()
    : String(viewKeyObj);
  log('BOT', `View key: ${viewKey.substring(0, 20)}...`);

  loadState();

  log('BOT', `Program  : ${CONFIG.programId}`);
  log('BOT', `Network  : ${CONFIG.networkId}`);
  log('BOT', `Interval : ${CONFIG.scanIntervalMs / 1000}s`);
  console.log('');

  startApiServer();

  // Scanner setup
  try {
    await issueJwt();
    await ensureUuid(viewKey);
    scannerReady = true;
    log('BOT', 'Scanner ready.');
  } catch (e) {
    err('BOT', `Scanner setup failed: ${e.message} — will retry on next tick`);
  }

  // Refresh JWT every 12h
  setInterval(async () => {
    try { await issueJwt(); } catch (e) { err('AUTH', `JWT refresh failed: ${e.message}`); }
  }, 12 * 60 * 60 * 1000);

  await scanAndProcess();

  setInterval(async () => {
    if (!scannerReady) {
      try {
        await issueJwt();
        await ensureUuid(viewKey);
        scannerReady = true;
        log('BOT', 'Scanner ready (recovered).');
      } catch (e) {
        err('BOT', `Scanner retry failed: ${e.message}`);
        return;
      }
    }
    await scanAndProcess();
  }, CONFIG.scanIntervalMs);
}

main().catch(e => { err('FATAL', e.message); process.exit(1); });
