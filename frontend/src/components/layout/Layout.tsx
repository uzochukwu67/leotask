import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Code2, Layers } from 'lucide-react';
import { WalletMultiButton } from '@provablehq/aleo-wallet-adaptor-react-ui';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row relative overflow-hidden bg-background">
      {/* Noise Overlay */}
      <div className="noise-overlay pointer-events-none z-50"></div>

      {/* Sidebar */}
      <motion.aside 
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full md:w-64 border-r border-white/10 glass-panel flex flex-col p-6 z-10 sticky top-0"
      >
        <div className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 rounded-lg bg-black border border-cyan-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.2)]">
            <Layers className="text-cyan-400" size={20} />
          </div>
          <h1 className="text-xl font-bold tracking-tighter bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            ALEO ADVANCED
          </h1>
        </div>

        <nav className="flex-1 space-y-2">
          <NavItem icon={<Activity size={18} />} label="Dashboard" active />
          <NavItem icon={<Code2 size={18} />} label="Automation" />
        </nav>

        <div className="mt-auto pt-6 border-t border-white/10 flex justify-center">
          <WalletMultiButton className="w-full justify-center !bg-cyan-950 hover:!bg-cyan-900 border border-cyan-500/30 text-cyan-400 font-mono text-xs tracking-wider uppercase transition-all shadow-[0_0_15px_rgba(6,182,212,0.1)]" />
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-12 relative z-10 overflow-y-auto h-screen">
        {children}
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <button className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-all ${
      active 
        ? 'bg-white/10 text-white border border-white/10 shadow-lg' 
        : 'text-zinc-400 hover:bg-white/5 hover:text-white'
    }`}>
      {icon}
      <span className="font-medium text-sm tracking-wide">{label}</span>
    </button>
  );
}
