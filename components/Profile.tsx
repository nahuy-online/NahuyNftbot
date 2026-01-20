
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
  
  const [showHistory, setShowHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'assets' | 'bonus' | 'locked' | 'serials'>('assets');
  const [history, setHistory] = useState<NftTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
      const interval = setInterval(() => setNow(Date.now()), 60000);
      return () => clearInterval(interval);
  }, []);
  
  useEffect(() => {
      if (showHistory) {
          document.body.style.overflow = 'hidden';
          // Load history for asset-related views, but 'serials' relies on user object mostly
          if (historyFilter !== 'serials') loadHistoryData();
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
      if (!targetAddress) return alert(t('connect_first'));
      if (user.nftBalance.available <= 0) return alert(t('no_available'));
      
      if(window.confirm(t('confirm_withdraw', { amount: user.nftBalance.available, address: targetAddress.slice(0,8) }))) {
          setWithdrawing(true);
          try {
            await withdrawNFTWithAddress(targetAddress);
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
      const inviteLink = `https://t.me/${BOT_USERNAME}/start?startapp=${user.referralCode}`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(t('share_text', { amount: user.nftBalance.total }))}`;
      if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(shareUrl);
      else window.open(shareUrl, '_blank');
  };

  const handleLanguageChange = (lang: 'en' | 'ru') => {
      setLanguage(lang);
      if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.selectionChanged();
  };

  const formatCrypto = (val: number) => (!val ? 0 : parseFloat(val.toFixed(4)));

  return (
    <>
    <div className="p-5 pb-24 space-y-6 animate-fade-in relative">
      <div className="flex items-center space-x-4 pb-2 border-b border-gray-800 justify-between">
        <div className="flex items-center space-x-4">
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
        <button onClick={() => onUpdate()} className="p-2 bg-gray-800 rounded-full text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">↻</button>
      </div>

      <div className="space-y-3">
        <div className="bg-gray-800/60 backdrop-blur-md rounded-2xl p-4 border border-white/5">
            <div className="flex justify-between items-center mb-3">
                <span className="text-gray-400 text-sm font-medium">{t('connect_wallet')}</span>
                <div className={`w-2 h-2 rounded-full ${userFriendlyAddress ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}></div>
            </div>
            <div className="w-full flex justify-center [&>div]:w-full"><TonConnectButton className="w-full" /></div>
        </div>
        <div className="bg-gray-800/60 backdrop-blur-md rounded-2xl p-3 border border-white/5 flex justify-between items-center">
             <span className="text-gray-400 text-sm font-medium ml-1">{t('language_settings')}</span>
             <div className="flex bg-gray-900 rounded-lg p-1 border border-white/5">
                 <button onClick={() => handleLanguageChange('en')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${language === 'en' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>EN</button>
                 <button onClick={() => handleLanguageChange('ru')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${language === 'ru' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>RU</button>
             </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 ml-1">{t('assets')}</h3>
        <div className="grid grid-cols-2 gap-3">
            <div onClick={() => { setHistoryFilter('assets'); setShowHistory(true); }}
                className="bg-gray-800 p-4 rounded-2xl border border-white/5 flex flex-col justify-between h-28 cursor-pointer hover:bg-gray-750 active:scale-95 transition-all relative group">
                <div className="text-gray-400 text-xs font-bold uppercase">{t('total_balance')}</div>
                <div className="text-3xl font-black text-white">{user.nftBalance.total} <span className="text-sm font-medium text-gray-500">NFT</span></div>
                <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-blue-500 w-full"></div></div>
            </div>
            
            <div onClick={() => { setHistoryFilter('locked'); setShowHistory(true); }}
                className="bg-gray-800 p-4 rounded-2xl border border-yellow-500/20 flex flex-col justify-between h-28 cursor-pointer hover:bg-gray-750 active:scale-95 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-yellow-500/10 rounded-bl-full -mr-8 -mt-8"></div>
                <div className="text-yellow-500/80 text-xs font-bold uppercase z-10">{t('locked')}</div>
                <div className="text-3xl font-black text-yellow-500 z-10">{user.nftBalance.locked} <span className="text-sm font-medium text-yellow-500/50">NFT</span></div>
            </div>

            <div className="col-span-2 bg-gradient-to-r from-gray-800 to-gray-800/50 p-3 rounded-2xl border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-xl">🎲</div>
                    <div>
                        <div className="text-xs font-bold text-gray-400 uppercase">{t('game_attempts')}</div>
                        <div className="text-lg font-bold text-white">{user.diceBalance.available} {t('spins')}</div>
                    </div>
                </div>
            </div>
        </div>
      </div>

      <div className="glass-panel p-5 rounded-2xl">
          <div className="flex justify-between items-end mb-4">
              <div 
                className="cursor-pointer group select-none"
                onClick={() => { setHistoryFilter('serials'); setShowHistory(true); }}
              >
                <div className="flex items-center gap-2">
                    <span className="text-gray-300 font-medium text-sm block mb-1 group-hover:text-white transition-colors underline decoration-dotted decoration-gray-500 underline-offset-4">
                        {t('available_withdraw')}
                    </span>
                    <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full group-hover:bg-gray-600 group-hover:text-white transition-all">?</span>
                </div>
                <span className="text-2xl font-bold text-green-400">{user.nftBalance.available} NFT</span>
              </div>
          </div>
          <button onClick={handleWithdraw} disabled={withdrawing || user.nftBalance.available === 0}
            className={`w-full py-4 rounded-xl font-bold shadow-lg transition-transform active:scale-95 ${user.nftBalance.available > 0 ? 'bg-white text-black hover:bg-gray-100' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}>
              {withdrawing ? t('withdraw_processing') : t('withdraw_btn')}
          </button>
      </div>

      <div className="pt-4 border-t border-gray-800 pb-safe">
          <div className="flex justify-between items-baseline mb-4">
             <h3 className="font-bold text-lg">{t('referral_bonus')}</h3>
             <button onClick={handleInvite} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-full font-bold transition-colors flex items-center gap-1 active:bg-blue-700">
                {t('invite_btn')}
             </button>
          </div>
          
          <div onClick={() => { setHistoryFilter('bonus'); setShowHistory(true); }}
             className="bg-gradient-to-r from-gray-800 to-gray-900 p-4 rounded-xl border border-white/5 flex justify-between items-center transition-all duration-300 hover:border-white/20 cursor-pointer group">
             <div className="text-xs text-gray-400">{t('bonus_balance')}</div>
             <div className="flex gap-3 text-xs font-mono font-bold">
                  <span className="text-blue-400">{formatCrypto(user.referralStats.bonusBalance.TON)} T</span>
                  <span className="text-green-400">{formatCrypto(user.referralStats.bonusBalance.USDT)} $</span>
                  <span className="text-yellow-500">{user.referralStats.bonusBalance.STARS} ★</span>
             </div>
          </div>
      </div>
    </div>
      
    {showHistory && (
        <HistoryModal 
            onClose={() => setShowHistory(false)} 
            filter={historyFilter} 
            history={history} 
            loading={loadingHistory}
            user={user}
        />
    )}
    </>
  );
};
