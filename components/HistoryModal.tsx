
import React from 'react';
import { NftTransaction, Currency } from '../types';
import { useTranslation } from '../i18n/LanguageContext';

interface HistoryModalProps {
    onClose: () => void;
    filter: 'assets' | 'bonus' | 'locked' | 'serials' | 'withdrawn';
    history: NftTransaction[];
    loading: boolean;
    user: any; // Passing partial user object for stats
}

const SerialList = ({ serials, isWithdrawn = false }: { serials?: number[], isWithdrawn?: boolean }) => {
    if (!serials || serials.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-2">
            {serials.map(s => (
                <span key={s} className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${isWithdrawn ? 'bg-red-900/20 text-red-500/50 border-red-900/20 line-through' : 'bg-black/30 text-gray-300 border-white/5'}`}>
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

    // Available Serials Logic
    const getAvailableSerials = () => {
        if (!user.reservedSerials) return [];
        const lockedSet = new Set<number>();
        if (user.nftBalance.lockedDetails) {
            user.nftBalance.lockedDetails.forEach((item: any) => {
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
            case 'serials': return t('reserved_serials'); // Updated Title
            case 'withdrawn': return 'Withdrawn';
            default: return t('tx_history');
        }
    };

    const getIcon = () => {
        switch(filter) {
            case 'bonus': return '💎';
            case 'locked': return '❄️';
            case 'serials': return '🔢';
            case 'withdrawn': return '📤';
            default: return '📂';
        }
    };

    const getColorClass = () => {
        switch(filter) {
            case 'bonus': return 'bg-purple-500/20 text-purple-400';
            case 'locked': return 'bg-cyan-500/20 text-cyan-400';
            case 'serials': return 'bg-blue-500/20 text-blue-400';
            case 'withdrawn': return 'bg-gray-700 text-gray-400';
            default: return 'bg-blue-500/20 text-blue-400';
        }
    };

    const availableSerials = getAvailableSerials();
    const totalLockedSerials = user.nftBalance.lockedDetails?.reduce((acc: number, item: any) => acc + (item.serials?.length || 0), 0) || 0;

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
                  
                  {/* === SERIALS LISTS (3 STACKED CARDS) === */}
                  {filter === 'serials' && (
                      <div className="p-4 space-y-4 animate-fade-in">
                          {/* 1. AVAILABLE CARD */}
                          <div className="bg-gray-800 p-4 rounded-xl border border-green-500/20 animate-fade-in">
                                <div className="text-xs text-green-400 font-bold uppercase mb-2 flex justify-between items-center">
                                    <span>{t('available_btn')}</span>
                                    <span className="bg-green-500/20 px-2 py-0.5 rounded-full text-[10px] text-green-400">{availableSerials.length}</span>
                                </div>
                                {availableSerials.length > 0 ? (
                                    <SerialList serials={availableSerials} />
                                ) : (
                                    <div className="text-xs text-gray-500 italic py-2 text-center">
                                        {t('no_available')}
                                    </div>
                                )}
                          </div>
                          {/* 2. LOCKED CARD */}
                          <div className="bg-gray-800 p-4 rounded-xl border border-cyan-500/20 animate-fade-in">
                                <div className="text-xs text-cyan-400 font-bold uppercase mb-2 flex justify-between items-center">
                                    <span>{t('locked')}</span>
                                    <span className="bg-cyan-500/20 px-2 py-0.5 rounded-full text-[10px] text-cyan-400">{totalLockedSerials}</span>
                                </div>
                                <div className="text-[10px] text-cyan-400/70 mb-3 flex items-center gap-1">
                                    <span>❄️</span> {t('locked_policy')}
                                </div>
                                {(!user.nftBalance.lockedDetails || user.nftBalance.lockedDetails.length === 0) ? (
                                     <div className="text-xs text-gray-500 italic py-2 text-center">No locked assets</div>
                                ) : (
                                    <div className="space-y-3">
                                        {user.nftBalance.lockedDetails.map((item: any, idx: number) => (
                                            <div key={idx} className={`p-3 rounded-lg border flex flex-col gap-2 ${item.isSeized ? 'bg-red-900/10 border-red-500/20' : 'bg-black/20 border-white/5'}`}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-sm text-white">{item.amount} NFT</span>
                                                        <span className="text-[10px] text-gray-500">{formatDate(item.unlockDate)}</span>
                                                    </div>
                                                    {!item.isSeized && <span className="text-cyan-300 font-mono text-[10px] bg-cyan-500/10 px-2 py-0.5 rounded">{formatTimeLeft(item.unlockDate)}</span>}
                                                </div>
                                                {item.serials && item.serials.length > 0 && (
                                                     <SerialList serials={item.serials} />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                          </div>
                          {/* 3. WITHDRAWN CARD */}
                          <div className="bg-gray-800 p-4 rounded-xl border border-white/5 animate-fade-in">
                                <div className="text-xs text-gray-400 font-bold uppercase mb-2 flex justify-between items-center">
                                    <span>Withdrawn</span>
                                    <span className="bg-gray-700 px-2 py-0.5 rounded-full text-[10px] text-white">{user.withdrawnSerials?.length || 0}</span>
                                </div>
                                {user.withdrawnSerials && user.withdrawnSerials.length > 0 ? (
                                    <SerialList serials={user.withdrawnSerials} isWithdrawn={true} />
                                ) : (
                                    <div className="text-xs text-gray-500 italic py-2 text-center">No withdrawn history</div>
                                )}
                          </div>
                      </div>
                  )}

                  {/* === LEGACY WITHDRAWN VIEW === */}
                  {filter === 'withdrawn' && (
                      <div className="p-5 animate-fade-in">
                          <div className="bg-gray-800 p-4 rounded-xl border border-red-500/10">
                            <div className="text-xs text-gray-500 font-bold uppercase mb-2 flex justify-between items-center">
                                <span>Withdrawn History</span>
                                <span className="bg-gray-700 px-2 py-0.5 rounded-full text-[10px] text-white">{user.withdrawnSerials?.length || 0}</span>
                            </div>
                            {user.withdrawnSerials && user.withdrawnSerials.length > 0 ? (
                                <SerialList serials={user.withdrawnSerials} isWithdrawn={true} />
                            ) : (
                                <div className="text-xs text-gray-500 italic py-4 text-center">No withdrawn items</div>
                            )}
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
                          
                          {/* STARS Balance Card with Lock Breakdown */}
                          <div className="p-4 rounded-2xl bg-gray-800 border border-white/5 space-y-3">
                              <div className="flex justify-between items-center">
                                  <div className="text-xs text-yellow-500 font-bold uppercase">STARS (Total)</div>
                                  <div className="text-lg font-bold text-white">
                                      {(user.referralStats.bonusBalance.STARS || 0) + (user.referralStats.lockedStars || 0)} ★
                                  </div>
                              </div>
                              
                              {/* Breakdown Bar */}
                              <div className="w-full h-1.5 bg-gray-700 rounded-full flex overflow-hidden">
                                  <div className="bg-yellow-500 h-full" style={{ width: `${((user.referralStats.bonusBalance.STARS || 0) / Math.max(1, (user.referralStats.bonusBalance.STARS || 0) + (user.referralStats.lockedStars || 0))) * 100}%` }}></div>
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>
                                      <span className="text-gray-400 block mb-0.5">{t('available_btn')}</span>
                                      <span className="text-yellow-500 font-bold">{user.referralStats.bonusBalance.STARS} ★</span>
                                  </div>
                                  <div className="text-right">
                                      <span className="text-cyan-400 block mb-0.5">{t('locked')} ❄️</span>
                                      <span className="text-white font-bold">{user.referralStats.lockedStars} ★</span>
                                  </div>
                              </div>
                              
                              {user.referralStats.lockedStars > 0 && (
                                <div className="text-[9px] text-gray-500 bg-black/20 p-2 rounded border border-white/5">
                                    {t('locked_policy')} (21 Days)
                                </div>
                              )}
                          </div>
                      </div>
                  )}

                  {/* === LOCKED VIEW === */}
                  {filter === 'locked' && (
                      <div className="p-4 space-y-3 animate-fade-in">
                        <div className="text-[10px] text-cyan-400 text-center mb-2 flex items-center justify-center gap-1">
                            <span>❄️</span> {t('locked_policy')}
                        </div>
                        {user.nftBalance.lockedDetails?.map((item: any, idx: number) => (
                            <div key={idx} className={`p-4 rounded-xl border flex flex-col gap-3 ${item.isSeized ? 'bg-red-900/10 border-red-500/20' : 'bg-gradient-to-r from-gray-800 to-cyan-900/20 border-cyan-500/20'}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-300 flex items-center justify-center font-bold border border-cyan-500/20">
                                            #{idx+1}
                                        </div>
                                        <div>
                                            <span className="font-bold block text-white">{item.amount} NFT <span className="text-cyan-400">*</span></span>
                                            <span className="text-xs text-gray-500">{formatDate(item.unlockDate)}</span>
                                        </div>
                                    </div>
                                    {!item.isSeized && <span className="text-cyan-300 font-mono text-[10px] bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">{formatTimeLeft(item.unlockDate)}</span>}
                                </div>
                                {item.serials && item.serials.length > 0 && (
                                     <div className="pt-2 border-t border-white/5">
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
                                                {isStarOrLocked && <span className="text-cyan-400 text-sm mb-1 ml-0.5" title="Locked/Stars">*</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                            }
                        </div>
                  )}
              </div>
        </div>
    );
};
