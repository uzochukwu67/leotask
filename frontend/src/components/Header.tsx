import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletMultiButton } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { truncateAddress, formatAleo } from '@/utils/aleo';
import { useBalance } from '@/hooks/useBalance';
import { useNavigate } from 'react-router-dom';

export function Header() {
  const { connected, address } = useWallet();
  const { publicBalance, loading, refresh } = useBalance();
  // use router to navigate to schedule page
  const navigate = useNavigate();


  return (
    <header className="border-b border-zkperp-border bg-zkperp-card sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-zkperp-accent to-indigo-400 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <span className="text-white font-bold text-sm">LT</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">Leotask</h1>
              <p className="text-xs text-gray-500 leading-none">Scheduled Transfers · Aleo</p>
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* route to schedule */}
            <button onClick={() => navigate('/schedule')} className="text-gray-400 hover:text-white transition-colors">
              Schedule
            </button>
            {/* Network badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-zkperp-dark rounded-full border border-zkperp-border">
              <div className="w-1.5 h-1.5 bg-zkperp-green rounded-full animate-pulse" />
              <span className="text-xs text-gray-400">Testnet</span>
            </div>

            <WalletMultiButton />
          </div>
        </div>
      </div>

      {/* Balance bar when connected */}
      {connected && address && (
        <div className="border-t border-zkperp-border bg-zkperp-dark/60 py-2">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600 text-xs">Address</span>
              <code className="text-zkperp-accent font-mono text-xs bg-zkperp-dark px-2 py-0.5 rounded border border-zkperp-border">
                {truncateAddress(address)}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1 bg-zkperp-dark rounded-lg border border-zkperp-border">
                <div className="w-4 h-4 rounded-full bg-zkperp-accent flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">A</span>
                </div>
                <span className="text-white text-sm font-medium">
                  {loading ? '···' : formatAleo(publicBalance)}
                </span>
                <span className="text-gray-500 text-xs">ALEO</span>
              </div>
              <button
                onClick={refresh}
                disabled={loading}
                className="text-gray-600 hover:text-gray-300 disabled:opacity-40 transition-colors p-1"
                title="Refresh balance"
              >
                <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
