
import React, { useState, useEffect } from 'react';
import { UserProfile, NftTransaction } from '../types';
import { withdrawNFTWithAddress, fetchNftHistory, debugResetDb } from '../services/mockApi';
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';
import { BOT_USERNAME } from '../constants';
import { useTranslation } from '../i18n/LanguageContext';
import { HistoryModal } from './HistoryModal';

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
  const [historyFilter, setHistoryFilter] = useState<'assets' | 'bonus' | 'locked' | 'serials' | 'withdrawn'>('assets');
  const [history, setHistory] = useState<NftTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Update timer every minute
  useEffect(() => {
      const interval = setInterval(() => setNow(Date.now()), 60000);
      return () => clearInterval(interval);
  }, []);
  
  // Lock body scroll when modal is open
  useEffect(() => {
      if (showHistory) {
          document.body.style.overflow = 'hidden';
          if (historyFilter !== 'serials' && historyFilter !== 'withdrawn') loadHistoryData();
      } else {
          document.body.style.overflow = '';
      }
      return () => { document.body.style.overflow = ''; };
  }, [showHistory, historyFilter]);

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
        // Use privacy-safe Referral Code if available, fallback to ID only if code is missing (shouldn't happen)
        const refParam = user.referralCode || `ref_${user.id}`;
        const inviteLink = `https://t.me/${BOT_USERNAME}?start=${refParam}`;
        const shareText = t('share_text', { amount: user.nftBalance.total });
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`;

        // Attempt 1: Native Telegram WebApp Method for t.me links
        if (window.Telegram?.WebApp?.openTelegramLink) {
            window.Telegram.WebApp.openTelegramLink(shareUrl);
        } 
        // Attempt 2: Standard Window Open (often intercepted by Telegram)
        else {
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
          case 'referral': return '💎';
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

  const formatCrypto = (val: number) => (!val ? 0 : parseFloat(val.toFixed(4)));

  const REF_PERCENTS = [11, 9, 7]; // Level 1, 2, 3

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
                {user.isAdmin && <span className="bg-red-500/20 text-red-400 text-[10px] px-1.5 rounded border border-red-500/20">ADMIN</span>}
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
                onClick={() => { setHistoryFilter('assets'); setShowHistory(true); }}
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
            <div onClick={() => { setHistoryFilter('locked'); setShowHistory(true); }}
                className="bg-gray-800 p-4 rounded-2xl border border-yellow-500/20 flex flex-col justify-between h-28 relative overflow-hidden cursor-pointer active:scale-95 transition-transform">
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
              <div 
                className="cursor-pointer group select-none"
                onClick={() => { setHistoryFilter('serials'); setShowHistory(true); }}
              >
                  <span className="text-gray-300 font-medium text-sm block mb-1 underline decoration-dotted decoration-gray-600 underline-offset-4">{t('available_withdraw')}</span>
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
               {[1, 2, 3].map((level, i) => (
                   <div key={level} className="bg-gray-800 p-2 rounded-lg text-center border border-white/5 relative overflow-hidden">
                       <div className="text-[10px] text-gray-500 uppercase z-10">{t('level')} {level}</div>
                       <div className="font-bold text-lg z-10">
                           {(user.referralStats as any)[`level${level}`]}
                       </div>
                        <div className={`text-[9px] font-bold px-1.5 rounded-full mt-1 z-10 inline-block ${
                           i === 0 ? 'bg-green-500/20 text-green-400' : 
                           i === 1 ? 'bg-blue-500/20 text-blue-400' : 
                           'bg-purple-500/20 text-purple-400'
                       }`}>
                           {REF_PERCENTS[i]}%
                       </div>
                   </div>
               ))}
          </div>

          <div 
             onClick={() => { setHistoryFilter('bonus'); setShowHistory(true); }}
             className="bg-gradient-to-r from-gray-800 to-gray-900 p-4 rounded-xl border border-white/5 flex justify-between items-center cursor-pointer hover:border-white/20 transition-colors"
          >
             <div className="text-xs text-gray-400">{t('total_rewards')}</div>
             <div className="flex gap-3 text-xs font-mono font-bold">
                  <span className="text-yellow-500">{user.referralStats.bonusBalance.STARS} ★</span>
                  <span className="text-blue-400">{formatCrypto(user.referralStats.bonusBalance.TON)} T</span>
                  <span className="text-green-400">{formatCrypto(user.referralStats.bonusBalance.USDT)} $</span>
             </div>
          </div>
      </div>

      {/* DEBUG BUTTON */}
      <div className="pt-8 pb-4 flex justify-center opacity-50 hover:opacity-100 transition-opacity">
          <button 
            onClick={handleDebugReset}
            className="text-[10px] font-mono text-red-500 border border-red-500/30 px-3 py-1 rounded hover:bg-red-500/10"
          >
              ⚠️ DEBUG: RESET DB
          </button>
      </div>
      
      {/* --- HISTORY MODAL --- */}
      {showHistory && (
        <HistoryModal 
            onClose={() => setShowHistory(false)} 
            filter={historyFilter} 
            history={history} 
            loading={loadingHistory}
            user={user}
        />
      )}
    </div>
  );
};
