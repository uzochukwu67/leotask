import { useState, useRef } from 'react';
import { useWallet, } from '@provablehq/aleo-wallet-adaptor-react';
import { useTransaction } from '@/hooks/useTransaction';
import { useKeeperBot, type BotTask } from '@/hooks/useKeeperBot';
import { useBalance } from '@/hooks/useBalance';
import { TransactionStatus } from '@/components/TransactionStatus';
import {
  randomField, formatAleo, parseAleo, truncateAddress,
  blocksToTime, timeAgo,
} from '@/utils/aleo';
import {
  PROGRAM_ID, BLOCKS_PER_MINUTE, PROOF_BUFFER_BLOCKS,
} from '@/utils/config';

const DELAY_PRESETS = [
  { label: '5m',  minutes: 5  },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h',  minutes: 60 },
  { label: '2h',  minutes: 120 },
  { label: '6h',  minutes: 360 },
];

// ─── Task card ────────────────────────────────────────────────────────────────

function TaskCard({ task, currentBlock }: { task: BotTask; currentBlock: number }) {
  const trigger  = parseInt(task.triggerBlock);
  const current  = parseInt(task.currentBlock) || currentBlock;
  const remaining = Math.max(0, trigger - current);
  const total    = trigger - Math.max(0, current - parseInt(task.blocksRemaining || '0') - remaining);
  const progress = total > 0 ? Math.min(100, Math.round(((total - remaining) / total) * 100)) : 100;
  const amountAleo = formatAleo(task.amount);

  return (
    <div className={`rounded-xl border p-4 transition-all ${
      task.ready
        ? 'border-zkperp-green/40 bg-zkperp-green/5'
        : 'border-zkperp-border bg-zkperp-dark/60'
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          {/* h1 warning pls use schedule page this is v1 */}
          <h1 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-zkperp-accent/20 flex items-center justify-center text-zkperp-accent text-xs">⚡</span>
            Scheduled Transfer use schedule page for better experience
          </h1>
          <p className="text-xs text-gray-500 font-mono truncate">{task.taskId}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-gray-400 text-xs">→</span>
            <span className="text-white text-sm font-medium font-mono">
              {truncateAddress(task.recipient)}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-white font-semibold text-sm">{amountAleo} ALEO</span>
          {task.ready ? (
            <span className="flex items-center gap-1 text-xs font-medium text-zkperp-green px-2 py-0.5 rounded-full bg-zkperp-green/10 border border-zkperp-green/20">
              <span className="w-1.5 h-1.5 rounded-full bg-zkperp-green animate-pulse" />
              Executing
            </span>
          ) : (
            <span className="text-xs font-medium text-blue-400 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
              Pending
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="w-full bg-zkperp-border rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${
              task.ready ? 'bg-zkperp-green' : 'bg-zkperp-accent'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {task.ready
              ? 'Trigger block reached'
              : `${remaining.toLocaleString()} blocks · ~${blocksToTime(remaining)}`
            }
          </span>
          <span>Block {parseInt(task.triggerBlock).toLocaleString()}</span>
        </div>
      </div>

      <p className="text-xs text-gray-600 mt-2">Registered {timeAgo(task.registeredAt)}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function SchedulePage() {
  const { connected } = useWallet();
  const { publicBalance } = useBalance();
  const { execute, status, tempTxId, onChainTxId, error, reset } = useTransaction();
  const { health, tasks, refresh: refreshBot, registerTask } = useKeeperBot();

  const [recipient, setRecipient] = useState('');
  const [amountStr, setAmountStr] = useState('1');
  const [delayMinutes, setDelayMinutes] = useState(30);
  const [customDelay, setCustomDelay] = useState('');
  const taskIdRef = useRef<string | null>(null);

  const currentBlock  = health?.currentBlock ?? 0;
  const effectiveDelay = customDelay ? parseInt(customDelay) || delayMinutes : delayMinutes;
  const delayBlocks   = Math.ceil(effectiveDelay * BLOCKS_PER_MINUTE);
  const triggerBlock  = currentBlock + delayBlocks + PROOF_BUFFER_BLOCKS;
  const amountMicro   = parseAleo(amountStr);
  const isValidRecipient = /^aleo1[a-z0-9]{58}$/.test(recipient.trim());
  const isValidAmount = amountMicro > BigInt(0);
  const canSubmit = connected && isValidRecipient && isValidAmount && currentBlock > 0;

  const handleSchedule = async () => {
    if (!canSubmit) return;
    reset();
    taskIdRef.current = randomField();

    const txId = await execute({
      program: PROGRAM_ID,
      function: 'create_scheduled_transfer',
      inputs: [
        taskIdRef.current,
        recipient.trim(),
        `${amountMicro}u64`,
        `${triggerBlock}u32`,
      ],
      fee: 300000,
    } as Parameters<typeof execute>[0]);

    if (txId && taskIdRef.current) {
      await registerTask({
        taskId:       taskIdRef.current,
        recipient:    recipient.trim(),
        amount:       amountMicro.toString(),
        triggerBlock: triggerBlock,
      });
      refreshBot();
    }
  };

  const isSubmitting = status === 'submitting' || status === 'pending';

  return (
    <div className="min-h-screen bg-zkperp-dark">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Page header */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white">Schedule a Transfer (Note go to schedule page for better experience)</h2>
          <p className="text-gray-400 mt-1 text-sm">
            Escrow ALEO now, execute automatically at a future block. Powered by the Leotask keeper.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── Create Transfer Form (3/5) ── */}
          <div className="lg:col-span-3">
            <div className="bg-zkperp-card rounded-2xl border border-zkperp-border p-6 space-y-5">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-zkperp-accent/20 flex items-center justify-center text-zkperp-accent text-sm">⚡</span>
                New Scheduled Transfer
              </h3>

              {/* Recipient */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">
                  Recipient Address
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                  placeholder="aleo1..."
                  className={`w-full bg-zkperp-dark border rounded-xl px-4 py-3 text-sm font-mono text-white placeholder-gray-600 outline-none transition-colors focus:border-zkperp-accent ${
                    recipient && !isValidRecipient
                      ? 'border-zkperp-red/50 focus:border-zkperp-red'
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
                  {publicBalance !== null && (
                    <button
                      onClick={() => setAmountStr((Number(publicBalance) / 1_000_000).toFixed(6))}
                      className="text-xs text-zkperp-accent hover:text-indigo-300 transition-colors"
                    >
                      Max: {formatAleo(publicBalance)} ALEO
                    </button>
                  )}
                </div>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-zkperp-accent flex items-center justify-center">
                    <span className="text-white text-xs font-bold">A</span>
                  </div>
                  <input
                    type="number"
                    value={amountStr}
                    onChange={e => setAmountStr(e.target.value)}
                    min="0"
                    step="0.1"
                    placeholder="0.0"
                    className="w-full bg-zkperp-dark border border-zkperp-border rounded-xl pl-11 pr-16 py-3 text-sm text-white placeholder-gray-600 outline-none focus:border-zkperp-accent transition-colors"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">ALEO</span>
                </div>
                {amountMicro > BigInt(0) && (
                  <p className="text-xs text-gray-600 mt-1">{amountMicro.toLocaleString()} microcredits</p>
                )}
              </div>

              {/* Delay */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">
                  Execute After
                </label>
                {/* Preset chips */}
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
                {/* Custom input */}
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

              {/* Summary box */}
              {currentBlock > 0 && (
                <div className="bg-zkperp-dark rounded-xl border border-zkperp-border p-4 space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Transfer Summary</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-600 text-xs">Amount</p>
                      <p className="text-white font-medium">{formatAleo(amountMicro)} ALEO</p>
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
                  <p className="text-xs text-gray-600 pt-1 border-t border-zkperp-border">
                    Includes {PROOF_BUFFER_BLOCKS}-block ZK proof buffer
                  </p>
                </div>
              )}

              {/* Submit button */}
              <button
                onClick={handleSchedule}
                disabled={!canSubmit || isSubmitting}
                className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all ${
                  canSubmit && !isSubmitting
                    ? 'bg-zkperp-accent hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30'
                    : 'bg-zkperp-border text-gray-600 cursor-not-allowed'
                }`}
              >
                {!connected
                  ? 'Connect Wallet to Continue'
                  : isSubmitting
                  ? 'Submitting…'
                  : '⚡ Schedule Transfer'
                }
              </button>

              {/* Tx status */}
              <TransactionStatus
                status={status}
                tempTxId={tempTxId}
                onChainTxId={onChainTxId}
                error={error}
                onDismiss={reset}
              />
            </div>
          </div>

          {/* ── Active Tasks (2/5) ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Keeper bot status */}
            <div className="bg-zkperp-card rounded-2xl border border-zkperp-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${health?.online ? 'bg-zkperp-green animate-pulse' : 'bg-zkperp-red'}`} />
                  <span className="text-sm font-medium text-white">Keeper Bot</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${health?.online ? 'text-zkperp-green bg-zkperp-green/10' : 'text-zkperp-red bg-zkperp-red/10'}`}>
                    {health?.online ? 'Online' : 'Offline'}
                  </span>
                </div>
                {health?.online && (
                  <span className="text-xs text-gray-500 font-mono">
                    Block {health.currentBlock.toLocaleString()}
                  </span>
                )}
              </div>
              {!health?.online && (
                <p className="text-xs text-gray-600 mt-2">
                  Start the keeper: <code className="text-gray-400 bg-zkperp-dark px-1 py-0.5 rounded">node keeper-bot.mjs</code>
                </p>
              )}
            </div>

            {/* Tasks list */}
            <div className="bg-zkperp-card rounded-2xl border border-zkperp-border">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zkperp-border">
                <h3 className="text-sm font-semibold text-white">Active Tasks</h3>
                <div className="flex items-center gap-2">
                  {tasks.length > 0 && (
                    <span className="text-xs bg-zkperp-accent/20 text-zkperp-accent px-2 py-0.5 rounded-full font-medium">
                      {tasks.length}
                    </span>
                  )}
                  <button
                    onClick={refreshBot}
                    className="text-gray-600 hover:text-gray-300 transition-colors p-1"
                    title="Refresh"
                  >
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
                    <p className="text-gray-500 text-sm">No active tasks</p>
                    <p className="text-gray-600 text-xs mt-1">Schedule a transfer to get started</p>
                  </div>
                ) : (
                  tasks.map(task => (
                    <TaskCard
                      key={task.taskId}
                      task={task}
                      currentBlock={health?.currentBlock ?? 0}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Info box */}
            <div className="bg-zkperp-dark rounded-xl border border-zkperp-border p-4 space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">How it works</p>
              <ol className="text-xs text-gray-500 space-y-1.5 list-none">
                {[
                  'Your ALEO is escrowed in the on-chain program',
                  'Keeper bot monitors the block height',
                  'At trigger block, keeper auto-executes the transfer',
                  'Cancel anytime before execution to reclaim funds',
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
