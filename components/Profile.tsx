
import React, { useState, useEffect } from 'react';
import { UserProfile, NftTransaction, Currency } from '../types';
import { withdrawNFTWithAddress, fetchNftHistory, debugResetDb } from '../services/mockApi';
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';
import { BOT_USERNAME } from '../constants';
import { useTranslation } from '../i18n/LanguageContext';

interface ProfileProps {
  user: UserProfile;
  onUpdate: () => void;
}

export const Profile: React.FC<ProfileProps> = ({ user, onUpdate }) => {
  const [withdrawing, setWithdrawing] = useState(false);
  const userFriendlyAddress = useTonAddress();
  const [now, setNow] = useState(Date.now());
  const { t, language, setLanguage } = useTranslation();
  
  // History Modal State
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<NftTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Debug State
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param || "none";

  useEffect(() => {
      const interval = setInterval(() => setNow(Date.now()), 60000);
      return () => clearInterval(interval);
  }, []);
  
  useEffect(() => {
      if (showHistory) {
          document.body.style.overflow = 'hidden';
          loadHistoryData();
      } else {
          document.body.style.overflow = 'auto';
      }
      return () => { document.body.style.overflow = 'auto'; };
  }, [showHistory]);

  const loadHistoryData = async () => {
      setLoadingHistory(true);
      try {
          const data = await fetchNftHistory();
          setHistory(data);
      } catch (e) {
          console.error("Failed to load history", e);
      } finally {
          setLoadingHistory(false);
      }
  };

  const handleWithdraw = async () => {
      const targetAddress = userFriendlyAddress || user.walletAddress;

      if (!targetAddress) {
          if (window.Telegram?.WebApp) {
             window.Telegram.WebApp.showAlert(t('please_connect'));
          } else {
             alert(t('connect_first'));
          }
          return;
      }
      if (user.nftBalance.available <= 0) {
          if (window.Telegram?.WebApp) {
              window.Telegram.WebApp.showAlert(t('no_available'));
          }
          return;
      }
      
      const confirm = window.confirm(t('confirm_withdraw', { 
          amount: user.nftBalance.available, 
          address: `${targetAddress.slice(0,4)}...${targetAddress.slice(-4)}` 
      }));

      if(confirm) {
          setWithdrawing(true);
          try {
            await withdrawNFTWithAddress(targetAddress);
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
            alert(t('withdraw_sent'));
            onUpdate();
          } catch (e) {
            alert(t('withdraw_fail', { error: String(e) }));
          } finally {
            setWithdrawing(false);
          }
      }
  };

  const handleInvite = () => {
    try {
        const refCode = user.referralCode;
        
        if (!refCode) {
            alert("Referral code not loaded yet.");
            return;
        }

        // Updated Link Format: Standard Telegram Bot Deep Link
        // Format: https://t.me/BOTNAME?start=ref_CODE
        // This opens the bot with the start parameter. The bot then serves the MiniApp with this parameter.
        const inviteLink = `https://t.me/${BOT_USERNAME}?start=${refCode}`;
        
        const shareText = t('share_text', { amount: user.nftBalance.total });
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`;

        if (window.Telegram?.WebApp?.openTelegramLink) {
            window.Telegram.WebApp.openTelegramLink(shareUrl);
        } else {
            window.open(shareUrl, '_blank');
        }
    } catch (e) {
        console.error("Share failed", e);
        alert(t('share_error'));
    }
  };

  const handleDebugReset = async () => {
      if(confirm("⚠️ DEBUG: ARE YOU SURE? THIS WILL WIPE ALL DATA.")) {
          await debugResetDb();
          // Clear Local Storage for Mock Data cleanup
          localStorage.clear();
          alert("Database Cleared. Reloading...");
          window.location.reload();
      }
  };

  const formatTimeLeft = (target: number) => {
      const diff = target - now;
      if (diff <= 0) return t('ready');
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      return `${days}d ${hours}h`;
  };
  
  const formatDate = (ts: number) => {
      return new Date(ts).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
  };

  const getTxIcon = (type: string, assetType: string) => {
      if (assetType === 'dice') return '🎫';
      switch(type) {
          case 'purchase': return '🛍️';
          case 'win': return '🎲';
          case 'referral_reward': return '💰'; 
          case 'withdraw': return '📤';
          default: return '📄';
      }
  };

  const handleLanguageChange = (lang: 'en' | 'ru') => {
      setLanguage(lang);
      if (window.Telegram?.WebApp?.HapticFeedback) {
          window.Telegram.WebApp.HapticFeedback.selectionChanged();
      }
  };

  // Referral Visuals Config
  const REF_DISPLAY = [
      { lvl: 1, percent: '7%' },
      { lvl: 2, percent: '5%' },
      { lvl: 3, percent: '3%' },
  ];

  return (
    <div className="p-5 pb-24 space-y-6 animate-fade-in relative">
      {/* User Header */}
      <div className="flex items-center space-x-4 pb-2 border-b border-gray-800">
        <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold shadow-lg ring-2 ring-white/10">
            {user.username ? user.username.charAt(0).toUpperCase() : 'U'}
        </div>
        <div>
            <h2 className="text-xl font-bold text-white">@{user.username || 'User'}</h2>
            <div className="flex gap-2 items-center">
                <p className="text-xs text-gray-400 font-mono">ID: {user.id}</p>
            </div>
        </div>
      </div>

      {/* Settings & Wallet Row */}
      <div className="space-y-3">
        {/* Wallet Connect */}
        <div className="bg-gray-800/60 backdrop-blur-md rounded-2xl p-4 border border-white/5">
            <div className="flex justify-between items-center mb-3">
                <span className="text-gray-400 text-sm font-medium">{t('connect_wallet')}</span>
                <div className={`w-2 h-2 rounded-full ${userFriendlyAddress ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}></div>
            </div>
            <div className="w-full flex justify-center [&>div]:w-full">
                <TonConnectButton className="w-full" />
            </div>
        </div>

        {/* Language Switcher */}
        <div className="bg-gray-800/60 backdrop-blur-md rounded-2xl p-3 border border-white/5 flex justify-between items-center">
             <span className="text-gray-400 text-sm font-medium ml-1">{t('language_settings')}</span>
             <div className="flex bg-gray-900 rounded-lg p-1 border border-white/5">
                 <button 
                    onClick={() => handleLanguageChange('en')} 
                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all duration-200 ${language === 'en' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                 >
                    EN
                 </button>
                 <button 
                    onClick={() => handleLanguageChange('ru')} 
                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all duration-200 ${language === 'ru' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
                 >
                    RU
                 </button>
             </div>
        </div>
      </div>

      {/* Assets Grid */}
      <div>
        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 ml-1">{t('assets')}</h3>
        <div className="grid grid-cols-2 gap-3">
            {/* Total NFT - Clickable for History */}
            <div 
                onClick={() => setShowHistory(true)}
                className="bg-gray-800 p-4 rounded-2xl border border-white/5 flex flex-col justify-between h-28 cursor-pointer hover:bg-gray-750 active:scale-95 transition-all relative group"
            >
                <div className="flex justify-between items-start">
                    <div className="text-gray-400 text-xs font-bold uppercase">{t('total_balance')}</div>
                    <div className="bg-white/10 p-1 rounded-full opacity-50 group-hover:opacity-100 transition-opacity">
                         <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M6 20V10M18 20V4"/></svg>
                    </div>
                </div>
                <div className="text-3xl font-black text-white">{user.nftBalance.total} <span className="text-sm font-medium text-gray-500">NFT</span></div>
                <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 w-full"></div>
                </div>
            </div>
            
            {/* Locked NFT */}
            <div className="bg-gray-800 p-4 rounded-2xl border border-yellow-500/20 flex flex-col justify-between h-28 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-yellow-500/10 rounded-bl-full -mr-8 -mt-8"></div>
                <div className="text-yellow-500/80 text-xs font-bold uppercase z-10">{t('locked')}</div>
                <div className="text-3xl font-black text-yellow-500 z-10">{user.nftBalance.locked} <span className="text-sm font-medium text-yellow-500/50">NFT</span></div>
                <div className="text-[10px] text-gray-500 font-medium z-10">{t('unlocks_gradually')}</div>
            </div>

            {/* Dice Balance - New Card */}
            <div className="col-span-2 bg-gradient-to-r from-gray-800 to-gray-800/50 p-3 rounded-2xl border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-xl">
                        🎲
                    </div>
                    <div>
                        <div className="text-xs font-bold text-gray-400 uppercase">{t('game_attempts')}</div>
                        <div className="text-lg font-bold text-white">{user.diceBalance.available} {t('spins')}</div>
                    </div>
                </div>
                <button 
                    onClick={() => onUpdate()} 
                    className="text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors text-gray-300"
                >
                   {t('available_btn')}
                </button>
            </div>
        </div>
      </div>

      {/* Withdrawal Action */}
      <div className="glass-panel p-5 rounded-2xl">
          <div className="flex justify-between items-end mb-4">
              <div>
                <span className="text-gray-300 font-medium text-sm block mb-1">{t('available_withdraw')}</span>
                <span className="text-2xl font-bold text-green-400">{user.nftBalance.available} NFT</span>
              </div>
          </div>
          <button 
            onClick={handleWithdraw}
            disabled={withdrawing || user.nftBalance.available === 0}
            className={`w-full py-4 rounded-xl font-bold shadow-lg transition-transform active:scale-95 ${
                user.nftBalance.available > 0 
                ? 'bg-white text-black hover:bg-gray-100' 
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
              {withdrawing ? t('withdraw_processing') : t('withdraw_btn')}
          </button>
      </div>

      {/* Locked Details Accordion-ish */}
      {user.nftBalance.lockedDetails && user.nftBalance.lockedDetails.length > 0 && (
          <div className="space-y-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase ml-1">{t('vesting_schedule')}</h4>
              <div className="bg-gray-900 rounded-xl overflow-hidden border border-white/5 divide-y divide-white/5">
                  {user.nftBalance.lockedDetails.sort((a,b) => a.unlockDate - b.unlockDate).map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center p-3 hover:bg-white/5 transition-colors">
                          <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-300">
                                  #{idx+1}
                              </div>
                              <span className="font-bold text-white">{item.amount} NFT</span>
                          </div>
                          <span className="text-yellow-500 font-mono text-xs bg-yellow-500/10 px-2 py-1 rounded">
                              {formatTimeLeft(item.unlockDate)}
                          </span>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* Referral Program */}
      <div className="pt-4 border-t border-gray-800 pb-safe">
          <div className="flex justify-between items-baseline mb-4">
             <h3 className="font-bold text-lg">{t('referral_earnings')}</h3>
             <button 
                onClick={handleInvite}
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-full font-bold transition-colors flex items-center gap-1 active:bg-blue-700"
             >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                {t('invite_btn')}
             </button>
          </div>
          
          <div className="grid grid-cols-3 gap-2 mb-4">
               {REF_DISPLAY.map((item) => (
                   <div key={item.lvl} className="bg-gray-800 p-2 rounded-lg text-center border border-white/5 relative overflow-hidden group">
                       <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
                       <div className="flex flex-col items-center">
                            <div className="text-[10px] text-gray-500 uppercase flex items-center gap-1">
                                {t('level')} {item.lvl} 
                                <span className="text-blue-400 font-bold bg-blue-500/10 px-1 rounded">{item.percent}</span>
                            </div>
                            <div className="font-bold text-lg">
                                {(user.referralStats as any)[`level${item.lvl}`]}
                            </div>
                       </div>
                   </div>
               ))}
          </div>

          <div className="bg-gradient-to-r from-gray-800 to-gray-900 p-4 rounded-xl border border-white/5 flex justify-between items-center">
             <div className="text-xs text-gray-400">{t('total_rewards')}</div>
             <div className="flex gap-3 text-xs font-mono font-bold">
                  <span className="text-yellow-500">{user.referralStats.earnings.STARS} ★</span>
                  <span className="text-blue-400">{user.referralStats.earnings.TON} T</span>
                  <span className="text-green-400">{user.referralStats.earnings.USDT} $</span>
             </div>
          </div>
      </div>

      {/* --- DEBUG ZONE --- */}
      <div className="mt-8 p-4 bg-red-900/20 border border-red-500/30 rounded-xl space-y-3">
          <div className="flex items-center gap-2 mb-2 border-b border-red-500/20 pb-2">
            <span className="text-red-500 text-lg">🛠️</span>
            <span className="text-xs font-bold text-red-400 uppercase tracking-widest">Debug Zone</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="text-gray-500">Start Param:</div>
              <div className="text-white break-all">{startParam}</div>
              
              <div className="text-gray-500">My Ref Code:</div>
              <div className="text-green-400">{user.referralCode || "loading..."}</div>
              
              <div className="text-gray-500">Referred By:</div>
              <div className={`font-bold ${user.referrerId ? "text-green-400" : "text-red-500"}`}>
                  {user.referrerId ? user.referrerId : "none"}
              </div>

              <div className="text-gray-500 col-span-2 mt-1">Status:</div>
              <div className="col-span-2 bg-black/30 p-1.5 rounded text-yellow-300 break-words">
                  {user.referralDebug || "No debug info"}
              </div>
          </div>

          <button 
            onClick={handleDebugReset}
            className="w-full mt-2 text-xs font-bold text-white bg-red-600/80 hover:bg-red-500 py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
              <span>⚠️</span>
              WIPE DB & RESET
          </button>
      </div>
      
      {/* --- HISTORY MODAL --- */}
      {showHistory && (
          <div className="fixed inset-0 z-[60] bg-gray-900 flex flex-col animate-fade-in">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/90 backdrop-blur-md">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                      <span className="bg-blue-500/20 p-1.5 rounded-lg text-blue-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M6 20V10M18 20V4"/></svg>
                      </span>
                      {t('tx_history')}
                  </h2>
                  <button 
                    onClick={() => setShowHistory(false)}
                    className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 hover:text-white"
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
              </div>
              
              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-4">
                  {loadingHistory ? (
                      <div className="flex justify-center pt-10">
                          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
                      </div>
                  ) : history.length === 0 ? (
                      <div className="text-center text-gray-500 pt-10 flex flex-col items-center">
                          <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4 text-3xl opacity-50">📂</div>
                          <p>{t('no_tx')}</p>
                      </div>
                  ) : (
                      <div className="space-y-3">
                          {history.map((tx) => (
                              <div key={tx.id} className="bg-gray-800 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl bg-gray-700/50`}>
                                          {getTxIcon(tx.type, tx.assetType)}
                                      </div>
                                      <div>
                                          <div className="font-bold text-sm text-white flex items-center gap-1">
                                              {tx.description}
                                              {/* Show currency for purchases */}
                                              {tx.type === 'purchase' && tx.currency && (
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded ml-1 font-medium ${
                                                    tx.currency === Currency.STARS ? 'bg-yellow-500/20 text-yellow-400' :
                                                    tx.currency === Currency.TON ? 'bg-blue-500/20 text-blue-400' :
                                                    'bg-green-500/20 text-green-400'
                                                }`}>
                                                    {tx.currency}
                                                </span>
                                              )}
                                          </div>
                                          <div className="text-[10px] text-gray-500">{formatDate(tx.timestamp)}</div>
                                      </div>
                                  </div>
                                  <div className={`font-mono font-bold text-lg flex items-center gap-1 ${tx.type === 'withdraw' ? 'text-red-400' : 'text-green-400'}`}>
                                      {tx.type === 'withdraw' ? '-' : '+'}{tx.amount}
                                      <span className="text-xs opacity-70">
                                          {tx.assetType === 'dice' ? '🎲' : tx.assetType === 'nft' ? 'NFT' : ''}
                                      </span>
                                      {/* Show asterisk for locked NFTs (purchased with stars or won with star attempts) */}
                                      {tx.assetType === 'nft' && tx.isLocked && (
                                          <span className="text-yellow-500 text-sm transform -translate-y-1">*</span>
                                      )}
                                  </div>
                              </div>
                          ))}
                          
                          {/* Footer note for locked items */}
                          {history.some(h => h.isLocked) && (
                              <div className="pt-2 text-[10px] text-gray-500 text-center">
                                  {t('locked_policy')}
                              </div>
                          )}
                      </div>
                  )}
              </div>
          </div>
      )}
    </div>
  );
};
