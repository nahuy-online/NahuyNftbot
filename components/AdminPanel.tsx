
import React, { useState, useEffect } from 'react';
import { AdminStats, UserSortField, NftTransaction, Currency } from '../types';
import { fetchAdminStats, searchAdminUser, debugSeizeAsset, fetchAdminUsers, debugResetDb, fetchAdminTransactions } from '../services/mockApi';
import { useTranslation } from '../i18n/LanguageContext';

export const AdminPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users'>('dashboard');
  const { t } = useTranslation();
  
  // Dashboard State
  const [stats, setStats] = useState<AdminStats | null>(null);
  
  // Users List State
  const [userList, setUserList] = useState<any[]>([]);
  const [sortBy, setSortBy] = useState<UserSortField>('joined_at');
  const [sortOrder, setSortOrder] = useState<'asc'|'desc'>('desc');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);

  // User Detail / Search State
  const [searchId, setSearchId] = useState('');
  const [foundUser, setFoundUser] = useState<any | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  
  // Global Transactions (Revenue) Modal State
  const [showRevenueModal, setShowRevenueModal] = useState(false);
  const [globalTx, setGlobalTx] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txPage, setTxPage] = useState(0);
  const [txHasMore, setTxHasMore] = useState(true);
  
  // Filters for Global Tx
  const [filterCurrency, setFilterCurrency] = useState<'ALL' | 'TON' | 'USDT' | 'STARS'>('ALL');
  const [filterAsset, setFilterAsset] = useState<'ALL' | 'nft' | 'dice'>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'REVOKED'>('ALL');

  // Actions
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'dashboard') loadStats();
    if (activeTab === 'users' && userList.length === 0) loadUsers(true);
  }, [activeTab]);

  useEffect(() => {
     if (activeTab === 'users') loadUsers(true);
  }, [sortBy, sortOrder]);

  // Reload tx when filters change
  useEffect(() => {
      if (showRevenueModal) loadGlobalTransactions(true);
  }, [filterCurrency, filterAsset, filterStatus]);

  const loadStats = async () => {
    try {
        const data = await fetchAdminStats();
        setStats(data);
    } catch (e) {
        console.error("Stats error", e);
    }
  };

  const loadUsers = async (reset = false) => {
      setUsersLoading(true);
      try {
          const currentPage = reset ? 0 : page;
          const limit = 20;
          const res = await fetchAdminUsers(sortBy, sortOrder, limit, currentPage * limit);
          
          if (reset) {
              setUserList(res.users);
              setPage(1);
          } else {
              setUserList(prev => [...prev, ...res.users]);
              setPage(prev => prev + 1);
          }
          setHasMore(res.hasMore);
      } catch (e) {
          console.error("Load users error", e);
      } finally {
          setUsersLoading(false);
      }
  };

  const loadGlobalTransactions = async (reset = false) => {
      setTxLoading(true);
      try {
          const currentPage = reset ? 0 : txPage;
          const limit = 20;
          const offset = currentPage * limit;
          const res = await fetchAdminTransactions({
              currency: filterCurrency,
              assetType: filterAsset,
              status: filterStatus,
              limit,
              offset
          });

          if (reset) {
              setGlobalTx(res.transactions);
              setTxPage(1);
          } else {
              setGlobalTx(prev => [...prev, ...res.transactions]);
              setTxPage(prev => prev + 1);
          }
          setTxHasMore(res.hasMore);
      } catch (e) {
          console.error("Load global tx error", e);
      } finally {
          setTxLoading(false);
      }
  };

  const handleSearch = async (idToSearch?: string) => {
    const id = idToSearch || searchId;
    if (!id) return;
    
    setSearchLoading(true);
    setSearchError('');
    setFoundUser(null);
    try {
        const res = await searchAdminUser(id as any); // Type cast as API now handles strings
        if (res.found && res.user) {
            setFoundUser(res.user);
            setShowDetailModal(true);
        } else {
            setSearchError(t('admin_not_found'));
        }
    } catch (e) {
        setSearchError("API Error");
    } finally {
        setSearchLoading(false);
    }
  };

  const handleSeize = async (assetType: 'nft' | 'dice') => {
      if (!foundUser) return;
      
      const confirmMsg = t('admin_confirm_seize', { id: foundUser.id });
      if (window.confirm(confirmMsg)) {
          setActionLoading(true);
          try {
              const res = await debugSeizeAsset(assetType, foundUser.id);
              if (res.ok) {
                  alert("SUCCESS: " + res.message);
                  handleSearch(String(foundUser.id)); // Refresh data
              } else {
                  alert("FAILED: " + res.message);
              }
          } catch(e: any) {
              alert("Error: " + e.message);
          } finally {
              setActionLoading(false);
          }
      }
  };
  
  const handleRevokeTransaction = async (txId: string, assetType: string, userId: number) => {
      // Logic for revoking from Global list OR User Detail list
      const confirmMsg = `Are you sure you want to REVOKE transaction ${txId.slice(0, 8)}...? This will REMOVE the assets and REFUND any used bonuses.`;
      if (window.confirm(confirmMsg)) {
          setActionLoading(true);
          try {
              const res = await debugSeizeAsset(assetType as 'nft' | 'dice', userId, txId);
              if (res.ok) {
                  alert("SUCCESS: " + res.message);
                  // Refresh current view
                  if (showRevenueModal) loadGlobalTransactions(true);
                  if (showDetailModal && foundUser) handleSearch(String(foundUser.id));
              } else {
                  alert("Failed: " + res.message);
              }
          } catch (e: any) {
              alert("Error: " + e.message);
          } finally {
              setActionLoading(false);
          }
      }
  };

  const handleResetDb = async () => {
      const confirm1 = window.confirm("⚠️ DANGER: RESET DATABASE?");
      if (!confirm1) return;
      const confirm2 = window.confirm("⚠️ ARE YOU REALLY SURE? ALL DATA WILL BE LOST.");
      if (!confirm2) return;

      setActionLoading(true);
      try {
          await debugResetDb();
          alert("Database Cleared.");
          window.location.reload();
      } catch (e) {
          alert("Error: " + String(e));
          setActionLoading(false);
      }
  };

  const formatDate = (ts: number) => {
      return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'});
  };

  const renderTransactionItem = (tx: any, showUser: boolean) => {
      const isRevoked = tx.isRevoked || false;
      const isPurchase = tx.type === 'purchase';
      
      return (
          <div key={tx.id} className={`bg-gray-800 p-3 rounded-lg text-xs border ${isRevoked ? 'border-red-900 opacity-60' : 'border-white/5'} flex justify-between items-start relative`}>
              {isRevoked && <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  <div className="bg-red-900/90 text-white font-bold px-2 py-0.5 rounded text-[10px] transform -rotate-12 border border-red-500 shadow-lg">REFUNDED</div>
              </div>}

              <div className="max-w-[60%]">
                  {showUser && (
                      <div className="text-[9px] text-gray-400 font-bold mb-0.5 flex items-center gap-1">
                          @{tx.username || 'Unknown'} <span className="text-gray-600">#{tx.userId}</span>
                      </div>
                  )}
                  <div className={`font-bold ${isRevoked ? 'text-gray-500 line-through' : 'text-gray-300'}`}>
                      {tx.description.replace('[REVOKED] ', '')}
                  </div>
                  
                  {/* Payment Breakdown */}
                  {isPurchase && (
                      <div className="mt-1 space-y-0.5 font-mono">
                          {tx.priceAmount > 0 && (
                              <div className="text-[10px] text-gray-400">
                                  Paid: <span className={`${isRevoked ? 'text-gray-500 line-through' : 'text-white'}`}>{tx.priceAmount} {tx.currency}</span>
                              </div>
                          )}
                          {tx.bonusUsed > 0 && (
                              <div className="text-[10px] text-gray-400">
                                  Bonus: <span className={`${isRevoked ? 'text-gray-500 line-through' : 'text-green-400'}`}>+{tx.bonusUsed} {tx.currency}</span>
                                  {isRevoked && <span className="ml-2 text-green-500 font-bold no-underline inline-block bg-green-900/30 px-1 rounded">RETURNED</span>}
                              </div>
                          )}
                      </div>
                  )}

                  <div className="text-[10px] text-gray-600 mt-1">{formatDate(tx.timestamp)}</div>
                  <div className="text-[8px] text-gray-700 font-mono mt-0.5">{tx.id.slice(0,8)}...</div>
                  
                  {/* Serials Display */}
                  {tx.serials && tx.serials.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                          {tx.serials.slice(0, 10).map((s: number) => (
                              <span key={s} className={`text-[9px] font-mono px-1 rounded border ${isRevoked ? 'bg-red-900/20 border-red-900/30 text-red-500 line-through' : 'bg-black/30 border-white/5 text-gray-400'}`}>
                                  #{s}
                              </span>
                          ))}
                          {tx.serials.length > 10 && (
                              <span className="text-[8px] text-gray-500 flex items-center">+{tx.serials.length - 10} more</span>
                          )}
                      </div>
                  )}
              </div>

              <div className={`text-right flex flex-col items-end`}>
                  <div className={`${tx.type === 'withdraw' || tx.type === 'seizure' ? 'text-red-400' : 'text-green-400'} font-bold text-sm ${isRevoked ? 'line-through opacity-50' : ''}`}>
                      {tx.type === 'withdraw' || tx.type === 'seizure' ? '-' : '+'}{tx.amount}
                      <span className="text-[10px] opacity-70 ml-1 font-normal">
                          {tx.assetType === 'nft' ? 'NFT' : tx.assetType === 'dice' ? 'Dice' : tx.currency}
                      </span>
                  </div>
                  
                  {!isRevoked && tx.type === 'purchase' && (
                      <button 
                          onClick={() => handleRevokeTransaction(tx.id, tx.assetType, tx.userId || foundUser?.id)}
                          className="mt-2 bg-red-900/30 text-red-400 border border-red-900/50 hover:bg-red-900/50 text-[9px] px-2 py-1 rounded transition-colors uppercase font-bold"
                          title="Refund bonus & Revoke assets"
                      >
                          REVOKE
                      </button>
                  )}
              </div>
          </div>
      );
  };

  return (
    <>
      <div className="p-5 pb-24 space-y-6 animate-fade-in text-white relative">
        <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-400 to-orange-500">
              {t('admin_dashboard')}
            </h2>
            <div className="flex bg-gray-800 rounded-lg p-1 border border-white/5">
                <button onClick={() => setActiveTab('dashboard')} className={`px-3 py-1 text-xs font-bold rounded ${activeTab === 'dashboard' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>Stats</button>
                <button onClick={() => setActiveTab('users')} className={`px-3 py-1 text-xs font-bold rounded ${activeTab === 'users' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>Users</button>
            </div>
        </div>

        {activeTab === 'dashboard' && stats && (
            <div className="space-y-4 animate-fade-in">
              <div className="grid grid-cols-2 gap-3">
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

                  <div 
                    onClick={() => { setShowRevenueModal(true); loadGlobalTransactions(true); }}
                    className="bg-gray-800 p-4 rounded-xl border border-white/5 cursor-pointer hover:bg-gray-750 active:scale-95 transition-all group relative"
                  >
                      <div className="absolute top-2 right-2 text-gray-500 opacity-50 group-hover:opacity-100">↗</div>
                      <div className="text-gray-400 text-xs font-bold uppercase flex justify-between">
                          {t('admin_revenue')}
                          <span className="text-[9px] opacity-50 cursor-help" title="Click to view details">ⓘ</span>
                      </div>
                      <div className="flex flex-col text-xs font-mono font-bold">
                          <span className="text-blue-300">{stats.revenue.TON.toFixed(2)} T</span>
                          <span className="text-green-400">{stats.revenue.USDT.toFixed(0)} $</span>
                          <span className="text-yellow-500">{stats.revenue.STARS.toLocaleString()} ★</span>
                      </div>
                  </div>

                  <div className="col-span-2 bg-gray-800 p-4 rounded-xl border border-white/5 flex items-stretch justify-around divide-x divide-white/10">
                      <div className="text-center w-1/3 flex flex-col justify-center px-2">
                          <div className="text-gray-400 text-xs font-bold uppercase mb-1">{t('stats_sales')}</div>
                          <div className="text-2xl font-black text-blue-400">{stats.totalNftSold}</div>
                      </div>
                      <div className="w-2/3 flex flex-col px-4">
                          <div className="text-gray-400 text-xs font-bold uppercase mb-2 text-center">{t('stats_dice_summary')}</div>
                          <div className="flex justify-around items-center h-full pb-2">
                              <div className="text-center flex-1">
                                  <div className="text-xl font-black text-purple-400">{stats.totalDicePlays}</div>
                              </div>
                              <div className="text-gray-600 text-lg font-light">/</div>
                              <div className="text-center flex-1">
                                  <div className="text-xl font-black text-green-400">{stats.totalNftWonInDice}</div>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>

               <div className="bg-gray-800/50 p-4 rounded-2xl border border-white/10">
                  <h3 className="text-sm font-bold text-gray-400 uppercase mb-3">{t('admin_bonuses')}</h3>
                  <div className="grid grid-cols-2 gap-4">
                      <div>
                           <div className="text-xs text-green-400 mb-1 font-bold">{t('stats_earned')}</div>
                           <div className="space-y-1 font-mono text-sm">
                               <div>{stats.bonusStats.earned.TON.toFixed(2)} T</div>
                               <div>{stats.bonusStats.earned.USDT.toFixed(0)} $</div>
                               <div>{stats.bonusStats.earned.STARS.toLocaleString()} ★</div>
                           </div>
                      </div>
                      <div>
                           <div className="text-xs text-red-400 mb-1 font-bold">{t('stats_spent')}</div>
                           <div className="space-y-1 font-mono text-sm">
                               <div>{stats.bonusStats.spent.TON.toFixed(2)} T</div>
                               <div>{stats.bonusStats.spent.USDT.toFixed(0)} $</div>
                               <div>{stats.bonusStats.spent.STARS.toLocaleString()} ★</div>
                           </div>
                      </div>
                  </div>
              </div>
              
              <div className="bg-gray-800/50 p-4 rounded-2xl border border-white/10">
                  <div className="flex gap-2">
                      <input 
                          type="text" 
                          placeholder={t('admin_search_ph') + " or Username"}
                          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                          value={searchId}
                          onChange={(e) => setSearchId(e.target.value)}
                      />
                      <button 
                          onClick={() => handleSearch()}
                          disabled={searchLoading}
                          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg font-bold transition-colors"
                      >
                          {searchLoading ? '...' : t('admin_search_btn')}
                      </button>
                  </div>
                  {searchError && <div className="text-red-400 text-sm mt-2">{searchError}</div>}
              </div>

              <div className="pt-8 flex justify-center">
                  <button onClick={handleResetDb} disabled={actionLoading} className="bg-red-600 hover:bg-red-500 text-white font-black py-4 px-8 rounded-xl shadow-lg active:scale-95 transition-all border border-red-400">
                      ⚠️ RESET DATABASE
                  </button>
              </div>
            </div>
        )}

        {activeTab === 'users' && (
            <div className="space-y-4 animate-fade-in">
                <div className="flex gap-2 overflow-x-auto pb-2">
                    <select 
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as UserSortField)}
                      className="bg-gray-800 text-xs font-bold p-2 rounded border border-white/10"
                    >
                        <option value="joined_at">{t('sort_joined')}</option>
                        <option value="last_active">{t('sort_active')}</option>
                        <option value="nft_total">{t('sort_nfts')}</option>
                        <option value="referrals">{t('sort_refs')}</option>
                    </select>
                    <button onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} className="bg-gray-800 px-3 py-2 rounded border border-white/10 text-xs font-bold">
                        {sortOrder.toUpperCase()}
                    </button>
                </div>

                <div className="space-y-3">
                    {userList.map((u) => (
                        <div key={u.id} onClick={() => handleSearch(String(u.id))} className="bg-gray-800 p-3 rounded-xl border border-white/5 active:scale-95 transition-transform flex justify-between items-center">
                            <div>
                                <div className="font-bold flex items-center gap-2">@{u.username} <span className="text-[10px] text-gray-500 font-mono">#{u.id}</span></div>
                                <div className="text-[10px] text-gray-500 mt-1">{t('user_last_active')}: {formatDate(u.lastActive)}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-bold text-blue-400">{u.nftTotal} NFT</div>
                                <div className="text-[10px] text-gray-500">{u.level1} Refs</div>
                            </div>
                        </div>
                    ))}
                    {usersLoading && <div className="text-center text-xs text-gray-500">Loading...</div>}
                    {!usersLoading && hasMore && (
                        <button onClick={() => loadUsers(false)} className="w-full py-3 bg-gray-800 rounded-xl text-xs font-bold hover:bg-gray-700 transition-colors">{t('load_more')}</button>
                    )}
                </div>
            </div>
        )}
      </div>

      {/* USER DETAIL MODAL */}
      {showDetailModal && foundUser && (
          <div className="fixed top-0 left-0 right-0 bottom-[64px] z-40 bg-gray-900 flex flex-col animate-fade-in p-5 overflow-y-auto w-full">
              <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold">{t('admin_user_mgmt')}</h3>
                  <button onClick={() => setShowDetailModal(false)} className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center border border-white/10 hover:bg-gray-700 transition-colors">✕</button>
              </div>
              
              <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 space-y-4">
                  <div className="pb-4 border-b border-white/5">
                      <div className="flex justify-between items-start mb-2">
                          <div>
                              <div className="text-2xl font-bold break-all">@{foundUser.username}</div>
                              <div className="text-xs text-gray-400 font-mono">ID: {foundUser.id}</div>
                          </div>
                      </div>
                      <div className="bg-gray-900/50 p-2 rounded-lg border border-white/5 flex flex-col gap-1 text-[10px] text-gray-500 font-mono">
                          <div className="flex justify-between"><span>{t('user_ip')}:</span><span className="text-gray-300">{foundUser.ip || 'Unknown'}</span></div>
                          <div className="flex justify-between"><span>{t('user_joined')}:</span><span className="text-gray-300">{formatDate(foundUser.joinedAt)}</span></div>
                      </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-gray-900 p-2 rounded"><span className="text-gray-400 block">NFTs</span><span className="text-white font-bold text-lg">{foundUser.nftAvailable} <span className="text-xs text-gray-500">/ {foundUser.nftTotal}</span></span></div>
                      <div className="bg-gray-900 p-2 rounded"><span className="text-gray-400 block">Dice</span><span className="text-white font-bold text-lg">{foundUser.diceAvailable}</span></div>
                      <div className="bg-gray-900 p-2 rounded col-span-2">
                          <div className="flex justify-between items-center mb-1"><span className="text-gray-400 block">Rewards</span>{foundUser.referralStats && (<span className="text-[10px] text-gray-500 font-mono">L1:{foundUser.referralStats.level1} • L2:{foundUser.referralStats.level2} • L3:{foundUser.referralStats.level3}</span>)}</div>
                          <span className="font-mono text-xs flex gap-3"><span className="text-blue-400">{foundUser.rewards.TON} T</span><span className="text-green-400">{foundUser.rewards.USDT} $</span><span className="text-yellow-500">{foundUser.rewards.STARS} ★</span></span>
                      </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                      <button onClick={() => handleSeize('nft')} disabled={actionLoading} className="bg-red-900/40 border border-red-500/30 text-red-200 py-3 rounded-lg text-xs font-bold hover:bg-red-900/60 transition-colors">{t('admin_seize_nft')} (All Locked)</button>
                      <button onClick={() => handleSeize('dice')} disabled={actionLoading} className="bg-orange-900/40 border border-orange-500/30 text-orange-200 py-3 rounded-lg text-xs font-bold hover:bg-orange-900/60 transition-colors">{t('admin_seize_dice')} (All)</button>
                  </div>
              </div>

              <div className="mt-4 pb-20">
                  <h4 className="text-sm font-bold text-gray-400 uppercase mb-3">{t('user_history')}</h4>
                  <div className="space-y-2">
                      {foundUser.transactions && foundUser.transactions.length > 0 ? (
                          foundUser.transactions.slice(0, 50).map((tx: any) => renderTransactionItem(tx, false))
                      ) : (
                          <div className="text-center text-gray-500 text-xs py-4">No transactions</div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {showRevenueModal && (
          <div className="fixed top-0 left-0 right-0 bottom-[64px] z-40 bg-gray-900 flex flex-col animate-fade-in p-5 overflow-y-auto w-full">
              <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold flex items-center gap-2"><span className="text-green-400">💰</span> Revenue History</h3>
                  <button onClick={() => setShowRevenueModal(false)} className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center border border-white/10 hover:bg-gray-700 transition-colors">✕</button>
              </div>

              <div className="space-y-2 mb-4">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                      {['ALL', 'TON', 'USDT', 'STARS'].map((c) => (
                          <button key={c} onClick={() => setFilterCurrency(c as any)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${filterCurrency === c ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-white/10 text-gray-400'}`}>{c}</button>
                      ))}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                      {['ALL', 'nft', 'dice'].map((a) => (
                          <button key={a} onClick={() => setFilterAsset(a as any)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${filterAsset === a ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-800 border-white/10 text-gray-400'}`}>{a.toUpperCase()}</button>
                      ))}
                  </div>
                   <div className="flex gap-2 overflow-x-auto pb-1">
                      {['ALL', 'ACTIVE', 'REVOKED'].map((s) => (
                          <button key={s} onClick={() => setFilterStatus(s as any)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${filterStatus === s ? 'bg-red-600 border-red-500 text-white' : 'bg-gray-800 border-white/10 text-gray-400'}`}>{s}</button>
                      ))}
                  </div>
              </div>

              <div className="space-y-2 pb-10">
                  {txLoading && txPage === 0 ? (
                      <div className="text-center py-10">Loading...</div>
                  ) : globalTx.length === 0 ? (
                      <div className="text-center text-gray-500 py-10">No transactions found</div>
                  ) : (
                      globalTx.map((tx) => renderTransactionItem(tx, true))
                  )}
                  {!txLoading && txHasMore && (
                      <button onClick={() => loadGlobalTransactions(false)} className="w-full py-3 bg-gray-800 rounded-xl text-xs font-bold hover:bg-gray-700 transition-colors">{t('load_more')}</button>
                  )}
              </div>
          </div>
      )}
    </>
  );
};
