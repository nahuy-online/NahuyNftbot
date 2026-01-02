
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { LanguageProvider } from './i18n/LanguageContext';
import { initSession } from './utils/storage';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// 1. Initialize Session (Swap wallet data if user changed)
// Wrapped in try-catch to prevent crash in AI Studio Preview / restricted iframes
try {
  initSession();
} catch (e) {
  console.warn("Session init failed (likely due to iframe restrictions):", e);
}

// Public manifest for demonstration. Replace with your app's manifest URL in production.
const manifestUrl = 'https://ton-connect.github.io/demo-dapp-with-react-ui/tonconnect-manifest.json';

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <TonConnectUIProvider 
        manifestUrl={manifestUrl}
        actionsConfiguration={{
            twaReturnUrl: 'https://t.me/nahuy_NFT_bot' // Optional: improves UX when returning from wallet
        }}
    >
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </TonConnectUIProvider>
  </React.StrictMode>
);
