import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletModalProvider } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield';
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo';
import { Network } from '@provablehq/aleo-types';
import { DecryptPermission } from '@provablehq/aleo-wallet-adaptor-core';

import '@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css';

import { Header } from '@/components/Header';
import { SchedulePage } from '@/pages/SchedulePage';
import { MultitokenSchedulePage } from '@/pages/MultitokenSchedulePage';

function App() {
  return (
    <BrowserRouter>
      <AleoWalletProvider
        wallets={[new ShieldWalletAdapter({}), new LeoWalletAdapter()]}
        autoConnect={false}
        network={Network.TESTNET}
        decryptPermission={DecryptPermission.OnChainHistory}
        programs={[
          'automation_scheduled_transferv3.aleo',
          'schedule_multitoken.aleo',
          'credits.aleo',
          'token_registry.aleo',
        ]}
        onError={(error) => console.error(error.message)}
      >
        <WalletModalProvider>
          <div className="min-h-screen bg-zkperp-dark">
            <Header />
            <Routes>
              <Route path="/"         element={<SchedulePage />} />
              <Route path="/schedule" element={<MultitokenSchedulePage />} />
            </Routes>
          </div>
        </WalletModalProvider>
      </AleoWalletProvider>
    </BrowserRouter>
  );
}

export default App;
