import { motion } from 'framer-motion';
import { ShieldCheck, Clock, Repeat, ArrowRightLeft, DollarSign } from 'lucide-react';
import { Button } from '../ui/button';

const MOCK_RECEIPTS = [
  { id: '1', type: 'recurring', token: 'USDCx', amount: '500', status: 'active', expiry: 'Block 204000' },
  { id: '2', type: 'escrow', token: 'ALEO', amount: '25', status: 'pending', expiry: 'Block 205500' },
];

export function Dashboard() {
  return (
    <div className="max-w-6xl mx-auto space-y-12">
      <header className="mb-12">
        <motion.h2 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-5xl font-black tracking-tighter mb-4"
        >
          AUTOMATION HUB
        </motion.h2>
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-zinc-400 font-mono text-sm max-w-2xl leading-relaxed"
        >
          // TRUSTLESS PRIVATE SCHEDULING SYSTEM v5
          <br/>
          Deploy recurring payments, conditional transfers, and escrows securely to the Aleo Network using the Keeper protocol.
        </motion.p>
      </header>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <BentoCard 
          delay={0.2}
          title="ACTIVE TASKS" 
          value="12" 
          icon={<ActivityIcon />} 
          className="md:col-span-2 neon-border-cyan bg-gradient-to-br from-cyan-950/20 to-black/40"
        />
        <BentoCard 
          delay={0.3}
          title="KEEPER NETWORK" 
          value="ONLINE" 
          icon={<ShieldCheck className="text-green-400" />} 
          valueClass="text-green-400"
        />
        <BentoCard 
          delay={0.4}
          title="ALEO LOCKED" 
          value="450.00" 
          icon={<ArrowRightLeft className="text-cyan-400" />} 
        />
        <BentoCard 
          delay={0.5}
          title="USDCx LOCKED" 
          value="$12,400" 
          icon={<DollarSign className="text-blue-400" />} 
        />
        <BentoCard 
          delay={0.6}
          title="CURRENT BLOCK" 
          value="198,420" 
          icon={<Clock className="text-zinc-400" />} 
          valueClass="font-mono"
        />
      </div>

      {/* Receipts Section */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="mt-16"
      >
        <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
          <h3 className="text-xl font-bold tracking-tight">MY RECEIPTS</h3>
          <Button variant="outline" size="sm" className="font-mono text-xs tracking-wider">REFRESH_</Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {MOCK_RECEIPTS.map((r, i) => (
            <ReceiptCard key={r.id} receipt={r} delay={0.8 + (i * 0.1)} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function BentoCard({ title, value, icon, delay, className = "", valueClass = "" }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.4, ease: "easeOut" }}
      className={`glass-panel p-6 rounded-xl flex flex-col justify-between group hover:-translate-y-1 transition-all duration-300 ${className}`}
    >
      <div className="flex justify-between items-start mb-8">
        <span className="text-xs font-bold tracking-widest text-zinc-500 uppercase">{title}</span>
        <div className="p-2 bg-white/5 rounded-md border border-white/5 group-hover:bg-white/10 transition-colors">
          {icon}
        </div>
      </div>
      <div className={`text-4xl font-black tracking-tight ${valueClass}`}>
        {value}
      </div>
    </motion.div>
  );
}

function ReceiptCard({ receipt, delay }: any) {
  const isUsdcx = receipt.token === 'USDCx';
  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className={`glass-panel p-5 rounded-lg border-l-4 ${isUsdcx ? 'border-l-blue-500' : 'border-l-cyan-500'} flex flex-col gap-4 relative overflow-hidden`}
    >
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
        <Repeat size={100} />
      </div>
      
      <div className="flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${isUsdcx ? 'bg-blue-500/20 text-blue-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
            {receipt.type}
          </span>
          <span className="font-mono text-xs text-zinc-500">ID: {receipt.id.padStart(8, '0')}</span>
        </div>
        <span className="text-sm font-bold text-zinc-300">{receipt.expiry}</span>
      </div>

      <div className="z-10">
        <span className="text-3xl font-black">{receipt.amount} </span>
        <span className={`text-lg font-bold ${isUsdcx ? 'text-blue-400' : 'text-cyan-400'}`}>{receipt.token}</span>
      </div>

      <div className="flex justify-end mt-2 z-10">
        <Button variant="destructive" size="sm" className="font-mono text-xs tracking-wider uppercase">
          ESCAPE_REFUND
        </Button>
      </div>
    </motion.div>
  );
}

function ActivityIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
    </svg>
  );
}
