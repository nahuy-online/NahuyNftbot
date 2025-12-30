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
  const [isCanceled, setIsCanceled] = useState(false);
  const { t } = useTranslation();
  const [tonConnectUI] = useTonConnectUI();
  
  // Prevent double-firing in Strict Mode
  const initRef = useRef(false);

  // Helper to trigger registration flow
  const handleRegistration = async (refParam?: string) => {
      // Small delay to ensure Loading UI renders first
      await new Promise(r => setTimeout(r, 100));

      try {
          const webApp = window.Telegram?.WebApp;
          
          if (webApp) {
              // Check if showPopup is supported (v6.2+)
              // If isVersionAtLeast is undefined (very old versions), assume false.
              const supportsPopup = webApp.isVersionAtLeast && webApp.isVersionAtLeast('6.2');

              if (supportsPopup) {
                  webApp.showPopup({
                      title: 'Welcome to NFT Genesis',
                      message: 'By continuing, you agree to our Terms of Service and Privacy Policy.',
                      buttons: [
                          { type: 'default', text: 'Agree & Start', id: 'agree' },
                          { type: 'cancel', text: 'Cancel', id: 'cancel' }
                      ]
                  }, async (btnId) => {
                      if (btnId === 'agree') {
                          // Call API with register=true
                          const registeredData = await fetchUserProfile(refParam, true);
                          setUser(registeredData);
                      } else {
                          webApp.close();
                      }
                  });
              } else {
                  // Fallback for older versions (< 6.2) which don't support showPopup
                  // Using setTimeout to unblock the render thread before confirm
                  setTimeout(async () => {
                      const confirmed = window.confirm("Welcome to NFT Genesis\n\nBy continuing, you agree to our Terms of Service and Privacy Policy.");
                      if (confirmed) {
                          const registeredData = await fetchUserProfile(refParam, true);
                          setUser(registeredData);
                      } else {
                          webApp.close();
                      }
                  }, 50);
              }
          } else {
              // Browser Fallback (Localhost)
               setTimeout(async () => {
                  if (confirm("Welcome! Agree to Terms of Service?")) {
                      const registeredData = await fetchUserProfile(refParam, true);
                      setUser(registeredData);
                  } else {
                      setIsCanceled(true);
                  }
               }, 50);
          }
      } catch (e) {
          console.error("Registration error", e);
      }
  };

  const loadData = async () => {
    if (initRef.current) return;
    initRef.current = true;

    try {
      const manualRefCode = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
      console.log("Loading data with param:", manualRefCode);
      
      // 1. Fetch User (Normal Mode - No Register flag yet)
      const data = await fetchUserProfile(manualRefCode, false);
      
      // 2. Check isNewUser
      if (data.isNewUser) {
          // If user is new, trigger Popup
          await handleRegistration(manualRefCode);
      } else {
          // User exists, set state
          setUser(data);
      }

    } catch (e) {
      console.error("Failed to load user", e);
    }
  };

  const refreshUser = () => {
      fetchUserProfile().then(setUser);
  };

  useEffect(() => {
    // Notify Telegram WebApp we are ready
    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
        window.Telegram.WebApp.enableClosingConfirmation();
    }
    
    loadData();
  }, [tonConnectUI]);

  // --- RENDERING ---

  if (isCanceled) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-6 text-center">
            <div>
                <h1 className="text-xl font-bold text-red-400 mb-2">Registration Canceled</h1>
                <p className="text-gray-400 mb-4">You must accept the terms to use this application.</p>
                <button 
                    onClick={() => window.location.reload()}
                    className="bg-gray-800 px-4 py-2 rounded-lg"
                >
                    Restart
                </button>
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