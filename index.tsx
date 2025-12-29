import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { LanguageProvider } from './i18n/LanguageContext';
import { UserScopedStorage } from './utils/storage';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Public manifest for demonstration. Replace with your app's manifest URL in production.
const manifestUrl = 'https://ton-connect.github.io/demo-dapp-with-react-ui/tonconnect-manifest.json';

// Initialize the custom storage that separates sessions by Telegram User ID
const storage = new UserScopedStorage();

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <TonConnectUIProvider 
        manifestUrl={manifestUrl}
        actionsConfiguration={{
            twaReturnUrl: 'https://t.me/nahuy_NFT_bot' // Optional: improves UX when returning from wallet
        }}
        // CRITICAL: Pass the custom storage here
        storage={storage}
    >
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </TonConnectUIProvider>
  </React.StrictMode>
);