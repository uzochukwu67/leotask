import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletModalProvider } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo';
import { DecryptPermission } from '@provablehq/aleo-wallet-adaptor-core';
import { Network } from '@provablehq/aleo-types';
import '@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AleoWalletProvider
      wallets={[
        new LeoWalletAdapter({
          appName: 'ZKPerp',
        }),
      ]}
      autoConnect={true}
      network={Network.TESTNET}
      decryptPermission={DecryptPermission.UponRequest}
      programs={['automation_advanced_transfer_v5.aleo', 'advanced_pay.aleo']}
      onError={(error) => console.error(error.message)}
    >
      <WalletModalProvider>
        <App />
      </WalletModalProvider>
    </AleoWalletProvider>
  </React.StrictMode>,
)
