import React, { useEffect, useState, useRef } from 'react';
import { Shop } from './components/Shop';
import { DiceGame } from './components/DiceGame';
import { Profile } from './components/Profile';
import { UserProfile, Tab } from './types';
import { fetchUserProfile } from './services/mockApi';
import { useTranslation } from './i18n/LanguageContext';
import { useTonConnectUI } from '@tonconnect/ui-react';

// Simple SVG Icons for Navigation
const Icons = {
  Shop: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
  ),
  Dice: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><circle cx="15.5" cy="15.5" r="1.5"/></svg>
  ),
  Profile: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  )
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('shop');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCanceled, setIsCanceled] = useState(false);
  const { t } = useTranslation();
  const [tonConnectUI] = useTonConnectUI();
  
  const initRef = useRef(false);

  // Helper to safely check version and show popup
  const safeShowPopup = (title: string, message: string, onConfirm: () => void, onCancel: () => void) => {
      const webApp = window.Telegram?.WebApp;
      
      // Strict version check manually to avoid library errors
      let canUsePopup = false;
      if (webApp && webApp.version) {
          const v = parseFloat(webApp.version);
          if (!isNaN(v) && v >= 6.2) {
              canUsePopup = true;
          }
      }

      if (canUsePopup && webApp && webApp.showPopup) {
          try {
              webApp.showPopup({
                  title: title,
                  message: message,
                  buttons: [
                      { type: 'default', text: 'Agree & Start', id: 'agree' },
                      { type: 'cancel', text: 'Cancel', id: 'cancel' }
                  ]
              }, (btnId) => {
                  if (btnId === 'agree') onConfirm();
                  else onCancel();
              });
          } catch (e) {
              console.warn("showPopup failed despite version check, falling back", e);
              // Fallback if the method throws
              if (window.confirm(`${title}\n\n${message}`)) onConfirm();
              else onCancel();
          }
      } else {
          // Fallback for version < 6.2 or browser
          if (window.confirm(`${title}\n\n${message}`)) onConfirm();
          else onCancel();
      }
  };

  const handleRegistration = async (refParam?: string) => {
      // Delay slightly to allow UI paint
      await new Promise(r => setTimeout(r, 100));

      const webApp = window.Telegram?.WebApp;

      safeShowPopup(
          'Welcome to NFT Genesis',
          'By continuing, you agree to our Terms of Service and Privacy Policy.',
          async () => {
              // Confirm
              try {
                  const registeredData = await fetchUserProfile(refParam, true);
                  setUser(registeredData);
              } catch (e) {
                  setError("Registration failed. Check connection.");
              }
          },
          () => {
              // Cancel
              if (webApp && webApp.close) webApp.close();
              setIsCanceled(true);
          }
      );
  };

  const loadData = async () => {
    if (initRef.current) return;
    initRef.current = true;

    try {
      const manualRefCode = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
      
      // 1. Fetch User
      const data = await fetchUserProfile(manualRefCode, false);
      
      // 2. Check isNewUser
      if (data.isNewUser) {
          await handleRegistration(manualRefCode);
      } else {
          setUser(data);
      }
    } catch (e: any) {
      console.error("Failed to load user", e);
      setError(e.message || "Connection Error");
    }
  };

  const refreshUser = () => {
      fetchUserProfile().then(setUser).catch(console.error);
  };

  useEffect(() => {
    // Notify Telegram WebApp we are ready
    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
        // Check existence before calling
        if (window.Telegram.WebApp.enableClosingConfirmation) {
            window.Telegram.WebApp.enableClosingConfirmation();
        }
    }
    
    loadData();
  }, [tonConnectUI]);

  // --- RENDERING ---

  if (isCanceled) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-6 text-center">
            <div>
                <h1 className="text-xl font-bold text-red-400 mb-2">Registration Canceled</h1>
                <button onClick={() => window.location.reload()} className="bg-gray-800 px-4 py-2 rounded-lg mt-4">Restart</button>
            </div>
        </div>
      );
  }

  if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-6 text-center">
            <div>
                <div className="text-4xl mb-4">⚠️</div>
                <h1 className="text-xl font-bold text-red-400 mb-2">Connection Error</h1>
                <p className="text-gray-400 mb-4 text-sm">{error}</p>
                <p className="text-xs text-gray-600 mb-4">Ensure Backend is running on port 3001</p>
                <button onClick={() => window.location.reload()} className="bg-blue-600 px-6 py-2 rounded-lg font-bold">Retry</button>
            </div>
        </div>
      );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="animate-pulse flex flex-col items-center">
            <div className="h-12 w-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            {t('loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans selection:bg-blue-500/30">
      
      {/* Content Area */}
      <main className="max-w-md mx-auto min-h-screen relative">
        {activeTab === 'shop' && <Shop onPurchaseComplete={refreshUser} />}
        {activeTab === 'dice' && <DiceGame user={user} onUpdate={refreshUser} />}
        {activeTab === 'profile' && <Profile user={user} onUpdate={refreshUser} />}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-800/90 backdrop-blur-md border-t border-gray-700 pb-safe z-50">
        <div className="max-w-md mx-auto flex justify-around items-center h-16">
          <button
            onClick={() => setActiveTab('shop')}
            className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
              activeTab === 'shop' ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icons.Shop />
            <span className="text-[10px] font-medium uppercase">{t('nav_shop')}</span>
          </button>
          
          <button
            onClick={() => setActiveTab('dice')}
            className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
              activeTab === 'dice' ? 'text-purple-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icons.Dice />
            <span className="text-[10px] font-medium uppercase">{t('nav_dice')}</span>
          </button>
          
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
              activeTab === 'profile' ? 'text-green-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icons.Profile />
            <span className="text-[10px] font-medium uppercase">{t('nav_profile')}</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;