import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { useTransaction } from '@/hooks/useTransaction';
import { useMultitokenBot, type MtTask } from '@/hooks/useMultitokenBot';
import { useBalance } from '@/hooks/useBalance';
import { TransactionStatus } from '@/components/TransactionStatus';
import { randomField, formatAleo, parseAleo, truncateAddress, blocksToTime } from '@/utils/aleo';
import {
  MT_PROGRAM_ID, KEEPER_ADDRESS, KNOWN_TOKENS,
  BLOCKS_PER_MINUTE, PROOF_BUFFER_BLOCKS,
} from '@/utils/config';





// ─── Constants ────────────────────────────────────────────────────────────────

const DELAY_PRESETS = [
  { label: '5m',  minutes: 5   },
  { label: '15m', minutes: 15  },
  { label: '30m', minutes: 30  },
  { label: '1h',  minutes: 60  },
  { label: '2h',  minutes: 120 },
  { label: '6h',  minutes: 360 },
];

const DECIMAL_OPTIONS = [
  { label: '6  (USDC)', value: 6 },
  { label: '8  (BTC)',  value: 8 },
  { label: '18 (ETH)',  value: 18 },
];

// ─── Task Card ────────────────────────────────────────────────────────────────

function MtTaskCard({ task, currentBlock }: { task: MtTask; currentBlock: number }) {
  const trigger    = parseInt(task.triggerBlock);
  const remaining  = Math.max(0, trigger - currentBlock);
  const isAleo     = task.tokenType === '0';
  const statusColor = {
    pending:   'text-blue-400 bg-blue-500/10 border-blue-500/20',
    executing: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    done:      'text-green-400 bg-green-500/10 border-green-500/20',
    failed:    'text-red-400 bg-red-500/10 border-red-500/20',
  }[task.status];

  const displayAmount = isAleo
    ? `${formatAleo(BigInt(task.amount))} ALEO`
    : `${task.amount} (raw)`;
  
  return (
    <div className={`rounded-xl border p-4 transition-all ${
      task.status === 'done'
        ? 'border-green-500/30 bg-green-500/5'
        : task.status === 'failed'
        ? 'border-red-500/30 bg-red-500/5'
        : 'border-zkperp-border bg-zkperp-dark/60'
    }`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-gray-600 font-mono truncate">{task.taskId}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-gray-400 text-xs">→</span>
            <span className="text-white text-sm font-medium font-mono">{truncateAddress(task.recipient)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-white font-semibold text-sm">{displayAmount}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusColor}`}>
            {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
          </span>
        </div>
      </div>

      {task.status === 'pending' && (
        <div className="space-y-1">
          <div className="w-full bg-zkperp-border rounded-full h-1 overflow-hidden">
            <div className="h-full bg-zkperp-accent rounded-full animate-pulse" style={{ width: remaining === 0 ? '100%' : '40%' }} />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{remaining === 0 ? 'Ready to execute' : `~${blocksToTime(remaining)} left`}</span>
            <span>Block {trigger.toLocaleString()}</span>
          </div>
        </div>
      )}

      {task.status === 'done' && task.txId && (
        <p className="text-[10px] text-gray-500 font-mono truncate mt-1">tx: {task.txId}</p>
      )}

      {!isAleo && (
        <p className="text-[10px] text-gray-600 mt-1 font-mono truncate">token: {task.tokenId}</p>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function MultitokenSchedulePage() {
  const { connected , requestRecords, requestTransactionHistory} = useWallet();
  const { publicBalance } = useBalance();
  const { execute, status, tempTxId, onChainTxId, error, reset } = useTransaction();
  const { health, tasks, refresh } = useMultitokenBot();

  // Token type
  const [tokenType, setTokenType] = useState<'aleo' | 'arc20'>('aleo');

  // ARC-20 fields
  const [tokenId, setTokenId]       = useState('');
  const [tokenDecimals, setTokenDecimals] = useState(6);

  // Common fields
  const [recipient, setRecipient]   = useState('');
  const [amountStr, setAmountStr]   = useState('1');
  const [delayMinutes, setDelayMinutes] = useState(30);
  const [customDelay, setCustomDelay]  = useState('');

  const taskIdRef = useRef<string | null>(null);

  // Derived
  const currentBlock    = health?.currentBlock ?? 0;
  const effectiveDelay  = customDelay ? parseInt(customDelay) || delayMinutes : delayMinutes;
  const delayBlocks     = Math.ceil(effectiveDelay * BLOCKS_PER_MINUTE);
  const triggerBlock    = currentBlock + delayBlocks + PROOF_BUFFER_BLOCKS;
  const isValidRecipient = /^aleo1[a-z0-9]{58}$/.test(recipient.trim());
  const isValidTokenId   = tokenType === 'aleo' || /^\d+field$/.test(tokenId.trim());

  // Amount parsing
  const aleoMicro = parseAleo(amountStr);            // BigInt microcredits for ALEO
  const arcAmount = (() => {
    try {
      const n = parseFloat(amountStr);
      if (isNaN(n) || n <= 0) return BigInt(0);
      return BigInt(Math.round(n * 10 ** tokenDecimals));
    } catch { return BigInt(0); }
  })();
  const isValidAmount = tokenType === 'aleo' ? aleoMicro > 0n : arcAmount > 0n;

  const canSubmit = connected && isValidRecipient && isValidAmount && isValidTokenId && currentBlock > 0;
  console.log(isValidRecipient, isValidAmount, isValidTokenId, currentBlock, connected)
  const isSubmitting = status === 'submitting' || status === 'pending';

  const handleSchedule = async () => {
    
    if (!canSubmit) return;
    reset();
    taskIdRef.current = randomField();

    if (tokenType === 'aleo') {
      await execute({
        program:  MT_PROGRAM_ID,
        function: 'create_aleo_transfer',
        inputs: [
          taskIdRef.current,
          recipient.trim(),
          `${aleoMicro}u64`,
          `${triggerBlock}u32`,
          KEEPER_ADDRESS,
        ],
        fee: 500000,
      } as Parameters<typeof execute>[0]);
    } else {
      await execute({
        program:  MT_PROGRAM_ID,
        function: 'create_token_transfer',
        inputs: [
          taskIdRef.current,
          recipient.trim(),
          `${arcAmount}u128`,
          `${triggerBlock}u32`,
          tokenId.trim(),
          KEEPER_ADDRESS,
        ],
        fee: 500000,
      } as Parameters<typeof execute>[0]);
    }

    // No bot registration — keeper discovers via record scanning automatically
    refresh();
  };


  useEffect(()=>{
    requestRecords("schedule_multitoken.aleo", true)
      .then((data)=>{
        
        console.log(data)
      })

      requestTransactionHistory("schedule_multitoken.aleo")
      .then((data)=>{
        console.log(data)
      })
  },[tokenType])
  // Pending/done task counts
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const doneTasks    = tasks.filter(t => t.status === 'done');

  return (
    <div className="min-h-screen bg-zkperp-dark">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-2xl font-bold text-white">Schedule a Transfer</h2>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zkperp-accent/20 text-zkperp-accent border border-zkperp-accent/30">
              v2 · Multitoken
            </span>
          </div>
          <p className="text-gray-400 text-sm">
            Schedule ALEO or any ARC-20 token transfer. Keeper discovers tasks automatically via record scanning.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── Create Form (3/5) ── */}
          <div className="lg:col-span-3">
            <div className="bg-zkperp-card rounded-2xl border border-zkperp-border p-6 space-y-5">

              {/* Token type toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Token</label>
                <div className="flex rounded-xl bg-zkperp-dark border border-zkperp-border p-1 gap-1">
                  {(['aleo', 'arc20'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => { setTokenType(t); setAmountStr('1'); }}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        tokenType === t
                          ? 'bg-zkperp-accent text-white shadow'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {t === 'aleo' ? 'Native ALEO' : 'ARC-20 Token'}
                    </button>
                  ))}
                </div>
              </div>

              {/* ARC-20 token fields */}
              {tokenType === 'arc20' && (
                <div className="space-y-3 p-4 rounded-xl bg-zkperp-dark border border-zkperp-border">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Token Details</p>

                  {/* Known token presets */}
                  {KNOWN_TOKENS.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {KNOWN_TOKENS.map(tk => (
                        <button
                          key={tk.tokenId}
                          onClick={() => { setTokenId(tk.tokenId); setTokenDecimals(tk.decimals); }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                            tokenId === tk.tokenId
                              ? 'bg-zkperp-accent/20 border-zkperp-accent/40 text-zkperp-accent'
                              : 'border-zkperp-border text-gray-400 hover:text-white hover:border-gray-500'
                          }`}
                        >
                          {tk.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Token ID input */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Token ID (field literal)</label>
                    <input
                      type="text"
                      value={tokenId}
                      onChange={e => setTokenId(e.target.value)}
                      placeholder="123456field"
                      className={`w-full bg-zkperp-card border rounded-xl px-3 py-2.5 text-sm font-mono text-white placeholder-gray-600 outline-none focus:border-zkperp-accent transition-colors ${
                        tokenId && !isValidTokenId ? 'border-zkperp-red/50' : 'border-zkperp-border'
                      }`}
                    />
                    {tokenId && !isValidTokenId && (
                      <p className="text-xs text-zkperp-red mt-1">Must end with "field" e.g. 123field</p>
                    )}
                  </div>

                  {/* Decimals selector */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Decimals</label>
                    <div className="flex gap-2">
                      {DECIMAL_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setTokenDecimals(opt.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            tokenDecimals === opt.value
                              ? 'bg-zkperp-accent/20 border-zkperp-accent/40 text-zkperp-accent'
                              : 'border-zkperp-border text-gray-400 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Recipient */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">Recipient Address</label>
                <input
                  type="text"
                  value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                  placeholder="aleo1..."
                  className={`w-full bg-zkperp-dark border rounded-xl px-4 py-3 text-sm font-mono text-white placeholder-gray-600 outline-none transition-colors focus:border-zkperp-accent ${
                    recipient && !isValidRecipient
                      ? 'border-zkperp-red/50'
                      : 'border-zkperp-border'
                  }`}
                />
                {recipient && !isValidRecipient && (
                  <p className="text-xs text-zkperp-red mt-1">Invalid Aleo address</p>
                )}
              </div>

              {/* Amount */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-400">Amount</label>
                  {tokenType === 'aleo' && publicBalance !== null && (
                    <button
                      onClick={() => setAmountStr((Number(publicBalance) / 1_000_000).toFixed(6))}
                      className="text-xs text-zkperp-accent hover:text-indigo-300 transition-colors"
                    >
                      Max: {formatAleo(publicBalance)} ALEO
                    </button>
                  )}
                </div>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-zkperp-accent flex items-center justify-center shrink-0">
                    <span className="text-white text-xs font-bold">{tokenType === 'aleo' ? 'A' : 'T'}</span>
                  </div>
                  <input
                    type="number"
                    value={amountStr}
                    onChange={e => setAmountStr(e.target.value)}
                    min="0"
                    step={tokenType === 'aleo' ? '0.1' : '1'}
                    placeholder="0.0"
                    className="w-full bg-zkperp-dark border border-zkperp-border rounded-xl pl-11 pr-20 py-3 text-sm text-white placeholder-gray-600 outline-none focus:border-zkperp-accent transition-colors"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">
                    {tokenType === 'aleo' ? 'ALEO' : 'tokens'}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {tokenType === 'aleo'
                    ? `${aleoMicro.toLocaleString()} microcredits`
                    : `${arcAmount.toString()} base units (u128)`
                  }
                </p>
              </div>

              {/* Delay */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">Execute After</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {DELAY_PRESETS.map(p => (
                    <button
                      key={p.minutes}
                      onClick={() => { setDelayMinutes(p.minutes); setCustomDelay(''); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        effectiveDelay === p.minutes && !customDelay
                          ? 'bg-zkperp-accent text-white'
                          : 'bg-zkperp-dark border border-zkperp-border text-gray-400 hover:text-white hover:border-gray-500'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={customDelay}
                    onChange={e => setCustomDelay(e.target.value)}
                    placeholder="Custom"
                    min="1"
                    className="w-28 bg-zkperp-dark border border-zkperp-border rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-zkperp-accent transition-colors"
                  />
                  <span className="text-gray-500 text-sm">minutes</span>
                </div>
              </div>

              {/* Summary */}
              {currentBlock > 0 && (
                <div className="bg-zkperp-dark rounded-xl border border-zkperp-border p-4 space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Summary</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-600 text-xs">Amount</p>
                      <p className="text-white font-medium">
                        {tokenType === 'aleo' ? `${formatAleo(aleoMicro)} ALEO` : `${amountStr} tokens`}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-xs">Delay</p>
                      <p className="text-white font-medium">~{blocksToTime(delayBlocks)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-xs">Trigger Block</p>
                      <p className="text-white font-medium font-mono">{triggerBlock.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-xs">Current Block</p>
                      <p className="text-white font-medium font-mono">{currentBlock.toLocaleString()}</p>
                    </div>
                  </div>
                  {tokenType === 'arc20' && tokenId && (
                    <div className="pt-2 border-t border-zkperp-border">
                      <p className="text-gray-600 text-xs">Token ID</p>
                      <p className="text-white font-mono text-xs truncate">{tokenId}</p>
                    </div>
                  )}
                  <p className="text-xs text-gray-600 pt-1 border-t border-zkperp-border">
                    Includes {PROOF_BUFFER_BLOCKS}-block ZK proof buffer · Keeper discovers via record scan
                  </p>
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSchedule}
                disabled={!canSubmit || isSubmitting}
                className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all ${
                  canSubmit && !isSubmitting
                    ? 'bg-zkperp-accent hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                    : 'bg-zkperp-border text-gray-600 cursor-not-allowed'
                }`}
              >
                {!connected
                  ? 'Connect Wallet to Continue'
                  : isSubmitting
                  ? 'Submitting…'
                  : `Schedule ${tokenType === 'aleo' ? 'ALEO' : 'Token'} Transfer`
                }
              </button>

              <TransactionStatus
                status={status}
                tempTxId={tempTxId}
                onChainTxId={onChainTxId}
                error={error}
                onDismiss={reset}
              />
            </div>
          </div>

          {/* ── Right Panel (2/5) ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Keeper bot status */}
            <div className="bg-zkperp-card rounded-2xl border border-zkperp-border p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${health?.online ? 'bg-green-400 animate-pulse' : 'bg-zkperp-red'}`} />
                  <span className="text-sm font-medium text-white">Keeper Bot</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    health?.online
                      ? health.scannerReady
                        ? 'text-green-400 bg-green-400/10'
                        : 'text-yellow-400 bg-yellow-400/10'
                      : 'text-zkperp-red bg-zkperp-red/10'
                  }`}>
                    {health?.online
                      ? health.scannerReady ? 'Scanner Ready' : 'Initializing'
                      : 'Offline'
                    }
                  </span>
                </div>
                {health?.online && (
                  <span className="text-xs text-gray-500 font-mono">
                    #{health.currentBlock.toLocaleString()}
                  </span>
                )}
              </div>

              {health?.online && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: 'Pending', value: health.tasks.pending },
                    { label: 'Ready',   value: health.tasks.ready   },
                    { label: 'Done',    value: health.tasks.done    },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-zkperp-dark rounded-lg p-2">
                      <p className="text-white font-bold text-lg">{value}</p>
                      <p className="text-gray-500 text-xs">{label}</p>
                    </div>
                  ))}
                </div>
              )}

              {!health?.online && (
                <p className="text-xs text-gray-600 mt-1">
                  Start: <code className="text-gray-400 bg-zkperp-dark px-1 py-0.5 rounded">npm run start:multitoken</code>
                </p>
              )}
            </div>

            {/* Tasks list */}
            <div className="bg-zkperp-card rounded-2xl border border-zkperp-border">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zkperp-border">
                <h3 className="text-sm font-semibold text-white">Tasks</h3>
                <div className="flex items-center gap-2">
                  {pendingTasks.length > 0 && (
                    <span className="text-xs bg-zkperp-accent/20 text-zkperp-accent px-2 py-0.5 rounded-full font-medium">
                      {pendingTasks.length} active
                    </span>
                  )}
                  <button onClick={refresh} className="text-gray-600 hover:text-gray-300 transition-colors p-1" title="Refresh">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {tasks.length === 0 ? (
                  <div className="py-10 text-center">
                    <div className="w-10 h-10 rounded-full bg-zkperp-dark border border-zkperp-border flex items-center justify-center mx-auto mb-3">
                      <span className="text-xl">⏰</span>
                    </div>
                    <p className="text-gray-500 text-sm">No tasks discovered yet</p>
                    <p className="text-gray-600 text-xs mt-1">
                      Keeper scans records every 30s
                    </p>
                  </div>
                ) : (
                  [...pendingTasks, ...doneTasks].map(task => (
                    <MtTaskCard
                      key={task.taskId}
                      task={task}
                      currentBlock={health?.currentBlock ?? 0}
                    />
                  ))
                )}
              </div>
            </div>

            {/* How it works */}
            <div className="bg-zkperp-dark rounded-xl border border-zkperp-border p-4 space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">How it works</p>
              <ol className="text-xs text-gray-500 space-y-1.5 list-none">
                {[
                  'Tokens escrowed in the on-chain program',
                  'Keeper gets a private TaskNotification record',
                  'Keeper scans its records, executes at trigger block',
                  'receipt_status mapping updates — visible on-chain',
                  'Cancel anytime with your CancelAuth record',
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-zkperp-border flex items-center justify-center text-[10px] text-gray-500 font-bold mt-0.5">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
