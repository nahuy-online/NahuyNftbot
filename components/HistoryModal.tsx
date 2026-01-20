
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

const SerialList = ({ serials }: { serials?: number[] }) => {
    if (!serials || serials.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-2">
            {serials.map(s => (
                <span key={s} className="text-[10px] font-mono font-bold bg-black/30 text-gray-300 px-1.5 py-0.5 rounded border border-white/5">
                    #{s}
                </span>
            ))}
        </div>
    );
};

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

    // Filter History Items
    const filteredHistory = history.filter(tx => {
        const isBonus = tx.type === 'referral_reward' || tx.type === 'referral' || (tx.type === 'purchase' && tx.assetType === 'currency');
        if (filter === 'bonus') return isBonus;
        return !isBonus;
    });

    // Filter Available Serials (Exclude currently locked ones)
    const getAvailableSerials = () => {
        if (!user.reservedSerials) return [];
        
        const lockedSet = new Set<number>();
        // Collect all currently active locks
        if (user.nftBalance.lockedDetails) {
            user.nftBalance.lockedDetails.forEach((item: any) => {
                // If unlock date is in the future, these serials are hidden from "Available" list
                if (item.unlockDate > Date.now() && item.serials) {
                    item.serials.forEach((s: number) => lockedSet.add(s));
                }
            });
        }
        
        return user.reservedSerials.filter((s: number) => !lockedSet.has(s));
    };

    // Helper for Titles/Icons
    const getTitle = () => {
        switch(filter) {
            case 'bonus': return t('bonus_balance');
            case 'locked': return t('vesting_schedule');
            case 'serials': return t('available_withdraw'); // Changed title context slightly
            default: return t('tx_history');
        }
    };

    const getIcon = () => {
        switch(filter) {
            case 'bonus': return '💎';
            case 'locked': return '🔒';
            case 'serials': return '🔢';
            default: return '📂';
        }
    };

    const getColorClass = () => {
        switch(filter) {
            case 'bonus': return 'bg-purple-500/20 text-purple-400';
            case 'locked': return 'bg-yellow-500/20 text-yellow-500';
            case 'serials': return 'bg-green-500/20 text-green-400';
            default: return 'bg-blue-500/20 text-blue-400';
        }
    };

    // Compute serials only if needed
    const availableSerials = filter === 'serials' ? getAvailableSerials() : [];

    return (
        <div className="fixed inset-0 z-[9999] bg-gray-900 flex flex-col animate-fade-in">
             <div className="flex-none flex items-center justify-between px-5 pb-4 pt-20 bg-gray-900 border-b border-gray-800 z-50 shadow-xl">
                  <h2 className="text-xl font-bold flex items-center gap-3">
                      <span className={`p-2 rounded-xl flex items-center justify-center ${getColorClass()}`}>
                        {getIcon()}
                      </span>
                      {getTitle()}
                  </h2>
                  <button onClick={onClose} className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 hover:text-white border border-white/10">✕</button>
              </div>
              
              <div className="flex-1 overflow-y-auto overflow-x-hidden pb-32">
                  
                  {/* === SERIALS VIEW (Filtered: Only Available) === */}
                  {filter === 'serials' && (
                      <div className="p-5 animate-fade-in">
                          <div className="bg-gray-800 p-4 rounded-xl border border-white/5">
                            <div className="text-xs text-green-400 font-bold uppercase mb-2 flex justify-between items-center">
                                <span>{t('available_btn')} (Unlocked)</span>
                                <span className="bg-green-500/20 px-2 py-0.5 rounded-full text-[10px] text-green-400">{availableSerials.length}</span>
                            </div>
                            {availableSerials.length > 0 ? (
                                <SerialList serials={availableSerials} />
                            ) : (
                                <div className="text-xs text-gray-500 italic py-4 text-center">{t('no_available')}</div>
                            )}
                          </div>
                          <div className="mt-2 text-[10px] text-gray-500 text-center px-4">
                              {t('locked_policy')}
                          </div>
                      </div>
                  )}

                  {/* === BONUS VIEW === */}
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

                  {/* === LOCKED VIEW === */}
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
                                
                                {item.serials && item.serials.length > 0 && (
                                     <div className="pt-2 border-t border-white/5">
                                         <div className="text-[10px] text-gray-500 mb-1 uppercase">{t('reserved_serials')} ({item.serials.length})</div>
                                         <SerialList serials={item.serials} />
                                     </div>
                                )}
                            </div>
                        ))}
                      </div>
                  )}

                  {/* === ASSETS / GENERAL HISTORY VIEW === */}
                  {filter === 'assets' && (
                        <div className="p-4 space-y-3">
                            {loading ? <div className="text-center pt-5">Loading...</div> : 
                            filteredHistory.length === 0 ? <div className="text-center text-gray-500 pt-5">{t('no_tx')}</div> :
                            filteredHistory.map((tx) => {
                                // Determine if we should show Star/Lock indicator
                                const isStarOrLocked = tx.isLocked || tx.currency === Currency.STARS;

                                return (
                                    <div key={tx.id} className="bg-gray-800 p-4 rounded-xl border border-white/5 flex flex-col gap-2">
                                        <div className="flex justify-between items-center w-full">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center text-xl bg-gray-700/30">
                                                    {getTxIcon(tx.type, tx.assetType)}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="font-bold text-sm text-white truncate flex items-center gap-1">
                                                        {tx.description}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <div className="text-[10px] text-gray-500 font-mono">{formatDate(tx.timestamp)}</div>
                                                        {/* Currency Badge */}
                                                        {tx.currency && (
                                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                                                tx.currency === Currency.STARS ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' :
                                                                tx.currency === Currency.TON ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                                                                'bg-green-500/10 text-green-400 border border-green-500/20'
                                                            }`}>
                                                                {tx.currency}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={`text-right ${tx.type === 'withdraw' || tx.type === 'seizure' ? 'text-red-400' : 'text-green-400'} font-mono font-bold flex items-center gap-0.5`}>
                                                {tx.type === 'withdraw' || tx.type === 'seizure' ? '-' : '+'}{tx.amount}
                                                {isStarOrLocked && <span className="text-yellow-500 text-sm mb-1 ml-0.5" title="Locked/Stars">*</span>}
                                            </div>
                                        </div>
                                        
                                        {tx.serials && tx.serials.length > 0 && (
                                            <div className="pl-[60px] opacity-70">
                                                 <SerialList serials={tx.serials} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                            }
                            
                            {/* Star Footer Legend */}
                            <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-gray-500">
                                <span className="text-yellow-500 text-sm">*</span>
                                <span>{t('locked_policy')}</span>
                            </div>
                        </div>
                  )}
                  
                  {/* === BONUS HISTORY === */}
                   {filter === 'bonus' && (
                      <div className="p-4 space-y-3">
                        {loading ? <div className="text-center pt-5">Loading...</div> : 
                         filteredHistory.length === 0 ? <div className="text-center text-gray-500 pt-5">{t('no_tx')}</div> :
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
                                    <div className={`text-right text-green-400 font-mono font-bold`}>
                                        +{tx.amount}
                                        <span className="text-[10px] ml-1 opacity-70">{tx.currency}</span>
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
