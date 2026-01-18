
import React from 'react';
import { NftTransaction, Currency } from '../types';
import { useTranslation } from '../i18n/LanguageContext';

interface HistoryModalProps {
    onClose: () => void;
    filter: 'assets' | 'bonus' | 'locked' | 'serials';
    history: NftTransaction[];
    loading: boolean;
    user: any; // Passing partial user object for stats
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ onClose, filter, history, loading, user }) => {
    const { t } = useTranslation();

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const formatTimeLeft = (target: number) => {
        const diff = target - Date.now();
        if (diff <= 0) return t('ready');
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        return `${days}d`;
    };

    const formatCrypto = (val: number) => (!val ? 0 : parseFloat(val.toFixed(4)));

    const getTxIcon = (type: string, assetType: string) => {
        if (assetType === 'dice') return '🎫';
        switch(type) {
            case 'purchase': return '🛍️';
            case 'win': return '🎲';
            case 'referral_reward': 
            case 'referral': return '💎'; 
            case 'withdraw': return '📤';
            case 'seizure': return '🚫';
            default: return '📄';
        }
    };

    const filteredHistory = history.filter(tx => {
        const isBonus = tx.type === 'referral_reward' || tx.type === 'referral' || (tx.type === 'purchase' && tx.assetType === 'currency');
        if (filter === 'bonus') return isBonus;
        return !isBonus;
    });

    return (
        <div className="fixed inset-0 z-[9999] bg-gray-900 flex flex-col animate-fade-in">
             <div className="flex-none flex items-center justify-between px-5 pb-4 pt-20 bg-gray-900 border-b border-gray-800 z-50 shadow-xl">
                  <h2 className="text-xl font-bold flex items-center gap-3">
                      <span className={`p-2 rounded-xl flex items-center justify-center ${
                          filter === 'bonus' ? 'bg-purple-500/20 text-purple-400' : 
                          filter === 'locked' ? 'bg-yellow-500/20 text-yellow-500' :
                          'bg-blue-500/20 text-blue-400'
                      }`}>
                        {filter === 'bonus' ? '💎' : filter === 'locked' ? '🔒' : '📂'}
                      </span>
                      {filter === 'bonus' ? t('bonus_balance') : filter === 'locked' ? t('vesting_schedule') : t('tx_history')}
                  </h2>
                  <button onClick={onClose} className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 hover:text-white border border-white/10">✕</button>
              </div>
              
              <div className="flex-1 overflow-y-auto overflow-x-hidden pb-32">
                  {filter === 'bonus' && user.referralStats && (
                      <div className="p-5 pb-0 grid grid-cols-1 gap-3 animate-fade-in">
                          <div className="grid grid-cols-2 gap-3">
                              <div className="p-4 rounded-2xl bg-gray-800 border border-white/5">
                                  <div className="text-xs text-blue-400 font-bold uppercase mb-1">TON</div>
                                  <div className="text-lg font-bold text-white">{formatCrypto(user.referralStats.bonusBalance.TON)}</div>
                              </div>
                              <div className="p-4 rounded-2xl bg-gray-800 border border-white/5">
                                  <div className="text-xs text-green-400 font-bold uppercase mb-1">USDT</div>
                                  <div className="text-lg font-bold text-white">{formatCrypto(user.referralStats.bonusBalance.USDT)}</div>
                              </div>
                          </div>
                      </div>
                  )}

                  {filter === 'locked' && (
                      <div className="p-4 space-y-3 animate-fade-in">
                        {user.nftBalance.lockedDetails?.map((item: any, idx: number) => (
                            <div key={idx} className={`p-4 rounded-xl border flex flex-col gap-3 ${item.isSeized ? 'bg-red-900/10 border-red-500/20' : 'bg-gray-800 border-white/5'}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-yellow-500/20 text-yellow-500 flex items-center justify-center font-bold">#{idx+1}</div>
                                        <div>
                                            <span className="font-bold block">{item.amount} NFT</span>
                                            <span className="text-xs text-gray-500">{formatDate(item.unlockDate)}</span>
                                        </div>
                                    </div>
                                    {!item.isSeized && <span className="text-yellow-500 font-mono text-[10px] bg-yellow-500/10 px-2 py-0.5 rounded">{formatTimeLeft(item.unlockDate)}</span>}
                                </div>
                            </div>
                        ))}
                      </div>
                  )}

                  {filter !== 'locked' && (
                      <div className="p-4 space-y-3">
                        {loading ? <div className="text-center pt-10">Loading...</div> : 
                         filteredHistory.length === 0 ? <div className="text-center text-gray-500 pt-10">{t('no_tx')}</div> :
                         filteredHistory.map((tx) => (
                                <div key={tx.id} className="bg-gray-800 p-4 rounded-xl border border-white/5 flex justify-between items-center">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center text-xl bg-gray-700/30">
                                            {getTxIcon(tx.type, tx.assetType)}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-bold text-sm text-white truncate">{tx.description}</div>
                                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">{formatDate(tx.timestamp)}</div>
                                        </div>
                                    </div>
                                    <div className={`text-right ${tx.type === 'withdraw' || tx.type === 'seizure' ? 'text-red-400' : 'text-green-400'} font-mono font-bold`}>
                                        {tx.type === 'withdraw' || tx.type === 'seizure' ? '-' : '+'}{tx.amount}
                                    </div>
                                </div>
                         ))
                        }
                      </div>
                  )}
              </div>
        </div>
    );
};
