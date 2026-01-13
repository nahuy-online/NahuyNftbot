
import React, { useState, useEffect } from 'react';
import { AdminStats, Currency } from '../types';
import { fetchAdminStats, searchAdminUser, debugSeizeAsset } from '../services/mockApi';
import { useTranslation } from '../i18n/LanguageContext';

export const AdminPanel: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [searchId, setSearchId] = useState('');
  const [foundUser, setFoundUser] = useState<any | null>(null);
  const [searchError, setSearchError] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
        const data = await fetchAdminStats();
        setStats(data);
    } catch (e) {
        console.error("Stats error", e);
    }
  };

  const handleSearch = async () => {
    if (!searchId) return;
    setLoading(true);
    setSearchError('');
    setFoundUser(null);
    try {
        const res = await searchAdminUser(parseInt(searchId));
        if (res.found && res.user) {
            setFoundUser(res.user);
        } else {
            setSearchError(t('admin_not_found'));
        }
    } catch (e) {
        setSearchError("API Error");
    } finally {
        setLoading(false);
    }
  };

  const handleSeize = async (assetType: 'nft' | 'dice') => {
      if (!foundUser) return;
      
      const confirmMsg = t('admin_confirm_seize', { id: foundUser.id });
      if (window.confirm(confirmMsg)) {
          setLoading(true);
          try {
              const res = await debugSeizeAsset(assetType, foundUser.id);
              if (res.ok) {
                  alert("SUCCESS: " + res.message);
                  handleSearch(); // Refresh user data
                  loadStats(); // Refresh stats
              } else {
                  alert("FAILED: " + res.message);
              }
          } catch(e: any) {
              alert("Error: " + e.message);
          } finally {
              setLoading(false);
          }
      }
  };

  return (
    <div className="p-5 pb-24 space-y-6 animate-fade-in text-white">
      <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-400 to-orange-500">
        {t('admin_dashboard')}
      </h2>

      {/* STATS GRID */}
      {stats && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                {/* Users (Total / Active) */}
                <div className="bg-gray-800 p-4 rounded-xl border border-white/5 flex flex-col justify-between">
                    <div className="text-gray-400 text-xs font-bold uppercase mb-2 text-center">{t('stats_users')}</div>
                    <div className="flex justify-around items-center h-full">
                        <div className="text-center">
                            <div className="text-2xl font-black text-white">{stats.totalUsers}</div>
                            <div className="text-[9px] text-gray-500 uppercase">{t('stats_users_total')}</div>
                        </div>
                        <div className="w-px h-8 bg-white/10 mx-1"></div>
                        <div className="text-center">
                            <div className="text-2xl font-black text-blue-400">{stats.activeUsers}</div>
                            <div className="text-[9px] text-gray-500 uppercase">{t('stats_users_active')}</div>
                        </div>
                    </div>
                </div>

                {/* Revenue */}
                <div className="bg-gray-800 p-4 rounded-xl border border-white/5">
                    <div className="text-gray-400 text-xs font-bold uppercase flex justify-between">
                        {t('admin_revenue')}
                        <span className="text-[9px] opacity-50 cursor-help" title="Based on current prices">ⓘ</span>
                    </div>
                    <div className="flex flex-col text-xs font-mono font-bold">
                        <span className="text-yellow-500">{stats.revenue.STARS.toLocaleString()} ★</span>
                        <span className="text-blue-300">{stats.revenue.TON.toFixed(2)} T</span>
                        <span className="text-green-400">{stats.revenue.USDT.toFixed(0)} $</span>
                    </div>
                </div>

                {/* NFT & Dice counts in one row (merged cell) */}
                <div className="col-span-2 bg-gray-800 p-4 rounded-xl border border-white/5 flex items-stretch justify-around divide-x divide-white/10">
                    <div className="text-center w-1/3 flex flex-col justify-center px-2">
                        <div className="text-gray-400 text-xs font-bold uppercase mb-1">{t('stats_sales')}</div>
                        <div className="text-2xl font-black text-blue-400">{stats.totalNftSold}</div>
                    </div>
                    
                    <div className="w-2/3 flex flex-col px-4">
                        <div className="text-gray-400 text-xs font-bold uppercase mb-2 text-center">{t('stats_dice_summary')}</div>
                        <div className="flex justify-around items-center h-full">
                            <div className="text-center">
                                <div className="text-xl font-black text-purple-400">{stats.totalDicePlays}</div>
                                <div className="text-[9px] text-gray-500 uppercase">{t('stats_dice_plays')}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-xl font-black text-green-400">{stats.totalNftWonInDice}</div>
                                <div className="text-[9px] text-gray-500 uppercase">{t('stats_dice_won')}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            {/* BONUS STATS */}
            <div className="bg-gray-800/50 p-4 rounded-2xl border border-white/10">
                <h3 className="text-sm font-bold text-gray-400 uppercase mb-3">{t('admin_bonuses')}</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                         <div className="text-xs text-green-400 mb-1 font-bold">{t('stats_earned')}</div>
                         <div className="space-y-1 font-mono text-sm">
                             <div>{stats.bonusStats.earned.STARS.toLocaleString()} ★</div>
                             <div>{stats.bonusStats.earned.TON.toFixed(2)} T</div>
                             <div>{stats.bonusStats.earned.USDT.toFixed(0)} $</div>
                         </div>
                    </div>
                    <div>
                         <div className="text-xs text-red-400 mb-1 font-bold">{t('stats_spent')}</div>
                         <div className="space-y-1 font-mono text-sm">
                             <div>{stats.bonusStats.spent.STARS.toLocaleString()} ★</div>
                             <div>{stats.bonusStats.spent.TON.toFixed(2)} T</div>
                             <div>{stats.bonusStats.spent.USDT.toFixed(0)} $</div>
                         </div>
                    </div>
                </div>
            </div>
          </div>
      )}

      {/* USER MANAGEMENT */}
      <div className="bg-gray-800/50 p-4 rounded-2xl border border-white/10">
          <h3 className="text-sm font-bold text-gray-400 uppercase mb-3">{t('admin_user_mgmt')}</h3>
          
          <div className="flex gap-2 mb-4">
              <input 
                type="number" 
                placeholder={t('admin_search_ph')}
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
              />
              <button 
                onClick={handleSearch}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg font-bold transition-colors"
              >
                  {loading ? '...' : t('admin_search_btn')}
              </button>
          </div>

          {searchError && <div className="text-red-400 text-sm bg-red-900/20 p-2 rounded">{searchError}</div>}

          {foundUser && (
              <div className="space-y-3 animate-fade-in">
                  <div className="bg-gray-900 p-3 rounded-lg border border-gray-700">
                      <div className="flex justify-between items-center mb-1">
                          <span className="text-lg font-bold">@{foundUser.username}</span>
                          <span className="text-xs font-mono text-gray-500">ID: {foundUser.id}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-gray-800 p-2 rounded">
                              <span className="text-gray-400 block">NFTs</span>
                              <span className="text-white font-bold">{foundUser.nftAvailable} / {foundUser.nftTotal}</span>
                          </div>
                          <div className="bg-gray-800 p-2 rounded">
                              <span className="text-gray-400 block">Dice Attempts</span>
                              <span className="text-white font-bold">{foundUser.diceAvailable}</span>
                          </div>
                          <div className="bg-gray-800 p-2 rounded col-span-2 flex justify-between">
                              <span className="text-gray-400">Bonus Bal:</span>
                              <span className="font-bold">{foundUser.rewards.STARS} ★ / {foundUser.rewards.TON} T</span>
                          </div>
                      </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => handleSeize('nft')}
                        className="bg-red-900/50 border border-red-500/30 text-red-200 py-3 rounded-lg text-xs font-bold hover:bg-red-900/80 transition-colors"
                      >
                          {t('admin_seize_nft')}
                      </button>
                      <button 
                        onClick={() => handleSeize('dice')}
                        className="bg-orange-900/50 border border-orange-500/30 text-orange-200 py-3 rounded-lg text-xs font-bold hover:bg-orange-900/80 transition-colors"
                      >
                          {t('admin_seize_dice')}
                      </button>
                  </div>
              </div>
          )}
      </div>
    </div>
  );
};
