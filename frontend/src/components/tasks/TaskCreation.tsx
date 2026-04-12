import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Repeat, ShieldAlert, Crosshair, ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '@radix-ui/react-label';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { TransactionOptions } from '@provablehq/aleo-types';

const TABS = [
  { id: 'scheduled', label: 'One-Time', icon: <ArrowRight size={16} /> },
  { id: 'recurring', label: 'Recurring', icon: <Repeat size={16} /> },
  { id: 'conditional', label: 'Conditional', icon: <Crosshair size={16} /> },
  { id: 'escrow', label: 'Escrow', icon: <ShieldAlert size={16} /> },
];

export function TaskCreation() {
  const { executeTransaction, connected } = useWallet();
  const [activeTab, setActiveTab] = useState('scheduled');
  const [tokenType, setTokenType] = useState<'ALEO' | 'USDCx'>('ALEO');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [keeperFee, setKeeperFee] = useState('0.05');
  const [triggerBlock, setTriggerBlock] = useState('');
  const [expiryBlock, setExpiryBlock] = useState('');

  // Recurring
  const [intervalBlocks, setIntervalBlocks] = useState('');
  const [maxExecutions, setMaxExecutions] = useState('');

  // Conditional
  const [targetPrice, setTargetPrice] = useState('');
  const [oracleAddress, setOracleAddress] = useState('');

  // Escrow
  const [requiredApprovals, setRequiredApprovals] = useState('');
  const [partyAddress, setPartyAddress] = useState('');

  const isUsdcx = tokenType === 'USDCx';

  const handleInitializeTask = async () => {
    if (!connected) {
      alert('Please connect your wallet first');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const taskId = Math.floor(Math.random() * 1000000000) + 'field';
      const keeper = 'aleo1keeper00000000000000000000000000000000000000000000000000000'; // Default keeper address
      
      const amountMicro = Math.floor(parseFloat(amount) * 1000000) + 'u64';
      const feeMicro = Math.floor(parseFloat(keeperFee) * 1000000) + 'u64';
      
      let programName = 'automation_advanced_transfer_v5.aleo';
      let functionName = '';
      let inputs: string[] = [];
      const suffix = isUsdcx ? '_usdcx' : '';

      if (activeTab === 'scheduled') {
        programName = 'automation_advanced_transfer_v5.aleo';
        functionName = 'create_sched_transfer' + suffix;
        inputs = [taskId, keeper, recipient, amountMicro, feeMicro, triggerBlock + 'u32', expiryBlock + 'u32'];
      } else if (activeTab === 'recurring') {
        programName = 'advanced_pay.aleo';
        functionName = 'create_recur_transfer' + suffix;
        inputs = [taskId, keeper, recipient, amountMicro, feeMicro, triggerBlock + 'u32', intervalBlocks + 'u32', maxExecutions + 'u32', expiryBlock + 'u32'];
      } else if (activeTab === 'conditional') {
        programName = 'advanced_pay.aleo';
        functionName = 'create_cond_transfer' + suffix;
        // condition_type = 1 (e.g. price > target)
        inputs = [taskId, keeper, recipient, amountMicro, feeMicro, triggerBlock + 'u32', '1u8', Math.floor(parseFloat(targetPrice) * 1000000) + 'u64', oracleAddress, expiryBlock + 'u32'];
      } else if (activeTab === 'escrow') {
        programName = 'advanced_pay.aleo';
        functionName = 'create_escrow' + suffix;
        inputs = [taskId, keeper, recipient, amountMicro, feeMicro, triggerBlock + 'u32', requiredApprovals + 'u8', partyAddress, expiryBlock + 'u32'];
      }

      const txOptions: TransactionOptions = {
        program: programName,
        function: functionName,
        inputs: inputs,
        fee: 50000,
        privateFee: false,
      };

      console.log('Executing transaction:', txOptions);
      const result = await executeTransaction(txOptions);
      console.log('Transaction Result:', result);
      alert('Task Initialized! TxID: ' + result?.transactionId);
    } catch (error) {
      console.error('Error executing transaction:', error);
      alert('Failed to execute transaction. Check console.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full flex flex-col items-center justify-center min-h-[80vh]">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`w-full glass-panel rounded-2xl overflow-hidden transition-all duration-500 ${isUsdcx ? 'neon-border-blue' : 'neon-border-cyan'}`}
      >
        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-black/20">
          <h2 className="text-2xl font-black tracking-tighter">NEW AUTOMATION</h2>
          
          <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
            <button 
              onClick={() => setTokenType('ALEO')}
              className={`px-4 py-1.5 rounded-md text-xs font-bold tracking-widest transition-all ${!isUsdcx ? 'bg-cyan-500 text-black shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 'text-zinc-500 hover:text-white'}`}
            >
              ALEO
            </button>
            <button 
              onClick={() => setTokenType('USDCx')}
              className={`px-4 py-1.5 rounded-md text-xs font-bold tracking-widest transition-all ${isUsdcx ? 'bg-blue-500 text-black shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'text-zinc-500 hover:text-white'}`}
            >
              USDCx
            </button>
          </div>
        </div>

        <div className="flex border-b border-white/5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-2 py-4 text-xs font-bold tracking-widest uppercase transition-all border-b-2 ${
                activeTab === tab.id 
                  ? (isUsdcx ? 'border-blue-500 text-white bg-blue-500/5' : 'border-cyan-500 text-white bg-cyan-500/5') 
                  : 'border-transparent text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-8 min-h-[400px] relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Common Inputs */}
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2 col-span-2">
                  <Label className="text-xs font-bold tracking-widest text-zinc-400">Recipient Address</Label>
                  <Input placeholder="aleo1..." value={recipient} onChange={e => setRecipient(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold tracking-widest text-zinc-400">Amount ({tokenType})</Label>
                  <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold tracking-widest text-zinc-400">Keeper Fee</Label>
                  <Input type="number" placeholder="0.00" value={keeperFee} onChange={e => setKeeperFee(e.target.value)} />
                </div>
              </div>

              {/* Dynamic Inputs */}
              {activeTab === 'recurring' && (
                <div className="grid grid-cols-2 gap-6 p-6 rounded-lg bg-white/5 border border-white/5">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold tracking-widest text-zinc-400">Interval Blocks</Label>
                    <Input type="number" placeholder="e.g. 5000" value={intervalBlocks} onChange={e => setIntervalBlocks(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold tracking-widest text-zinc-400">Max Executions</Label>
                    <Input type="number" placeholder="12" value={maxExecutions} onChange={e => setMaxExecutions(e.target.value)} />
                  </div>
                </div>
              )}

              {activeTab === 'conditional' && (
                <div className="grid grid-cols-2 gap-6 p-6 rounded-lg bg-white/5 border border-white/5">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold tracking-widest text-zinc-400">Target Price</Label>
                    <Input type="number" placeholder="$100.00" value={targetPrice} onChange={e => setTargetPrice(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold tracking-widest text-zinc-400">Oracle Address</Label>
                    <Input placeholder="aleo1oracle..." value={oracleAddress} onChange={e => setOracleAddress(e.target.value)} />
                  </div>
                </div>
              )}

              {activeTab === 'escrow' && (
                <div className="grid grid-cols-2 gap-6 p-6 rounded-lg bg-white/5 border border-white/5">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold tracking-widest text-zinc-400">Required Approvals</Label>
                    <Input type="number" placeholder="2" value={requiredApprovals} onChange={e => setRequiredApprovals(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold tracking-widest text-zinc-400">Party Address</Label>
                    <Input placeholder="aleo1..." value={partyAddress} onChange={e => setPartyAddress(e.target.value)} />
                  </div>
                </div>
              )}

              {/* Expiry Block */}
              <div className="pt-4 border-t border-white/5 space-y-2">
                <Label className="text-xs font-bold tracking-widest text-zinc-400 flex justify-between">
                  <span>Trigger Block</span>
                  <span className="text-zinc-600 font-mono">Current approx: 198420</span>
                </Label>
                <Input type="number" placeholder="e.g. 198500" value={triggerBlock} onChange={e => setTriggerBlock(e.target.value)} />
              </div>
              <div className="pt-4 space-y-2">
                <Label className="text-xs font-bold tracking-widest text-zinc-400 flex justify-between">
                  <span>Expiry Block (Escape Hatch)</span>
                </Label>
                <Input type="number" placeholder="e.g. 200000" value={expiryBlock} onChange={e => setExpiryBlock(e.target.value)} />
              </div>

            </motion.div>
          </AnimatePresence>

          <div className="mt-12 flex justify-end">
            <Button
              size="lg"
              className={`w-full md:w-auto font-mono uppercase tracking-widest ${isUsdcx ? 'bg-blue-500 hover:bg-blue-400 text-black' : 'bg-cyan-500 hover:bg-cyan-400 text-black'}`}
              onClick={handleInitializeTask}
              disabled={isSubmitting || !connected}
            >
              {isSubmitting ? 'GENERATING PROOF...' : connected ? 'INITIALIZE_TASK' : 'CONNECT WALLET FIRST'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
