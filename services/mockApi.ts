
import { UserProfile, Currency, NftTransaction } from '../types';
import { NFT_PRICES, DICE_ATTEMPT_PRICES } from '../constants';

const API_BASE = '/api'; 

// --- SAFE STORAGE WRAPPER ---
const memoryStore: Record<string, string> = {};

const safeStorage = {
    getItem: (key: string): string | null => {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return memoryStore[key] || null;
        }
    },
    setItem: (key: string, value: string) => {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            memoryStore[key] = value;
        }
    },
    removeItem: (key: string) => {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            delete memoryStore[key];
        }
    },
    length: () => {
         try { return localStorage.length; } catch(e) { return Object.keys(memoryStore).length; }
    },
    key: (index: number) => {
        try { return localStorage.key(index); } catch(e) { return Object.keys(memoryStore)[index]; }
    }
};

// --- STATEFUL MOCK ENGINE ---
const getLocalState = (userId: number, username: string) => {
    const key = `mock_user_${userId}`;
    const stored = safeStorage.getItem(key);
    if (stored) return JSON.parse(stored) as UserProfile;

    // Generate random mock code
    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padEnd(6, '0');
    const randomCode = `ref_${randomHex}`;

    const newUser: UserProfile = {
        id: userId,
        username: username,
        referralCode: randomCode, 
        referrerId: null,
        referralDebug: "Mock: User Created",
        nftBalance: { total: 0, available: 0, locked: 0, lockedDetails: [] },
        diceBalance: { available: 2, starsAttempts: 0, used: 0 },
        // Updated to use bonusBalance
        referralStats: { level1: 0, level2: 0, level3: 0, bonusBalance: { STARS: 0, TON: 0, USDT: 0 } }
    };
    safeStorage.setItem(key, JSON.stringify(newUser));
    return newUser;
};

const updateLocalState = (user: UserProfile) => {
    safeStorage.setItem(`mock_user_${user.id}`, JSON.stringify(user));
};

const findUserIdByCode = (code: string): number | null => {
    try {
        const len = safeStorage.length();
        for (let i = 0; i < len; i++) {
            const key = safeStorage.key(i);
            if (key && key.startsWith('mock_user_')) {
                const raw = safeStorage.getItem(key);
                if (raw) {
                    const data = JSON.parse(raw) as UserProfile;
                    if (data.referralCode && data.referralCode.toLowerCase() === code.toLowerCase()) {
                        return data.id;
                    }
                }
            }
        }
    } catch (e) {
        console.error("Mock DB Scan error", e);
    }
    return null;
};

const getLocalHistory = (userId: number): NftTransaction[] => {
    const key = `mock_history_${userId}`;
    const stored = safeStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
};

const addLocalHistory = (userId: number, tx: NftTransaction) => {
    const hist = getLocalHistory(userId);
    hist.unshift(tx);
    safeStorage.setItem(`mock_history_${userId}`, JSON.stringify(hist));
};

// HELPER: Distribute Rewards
const distributeMockRewards = (referrerId: number, totalAmount: number, currency: Currency) => {
    const key = `mock_user_${referrerId}`;
    const stored = safeStorage.getItem(key);
    if (!stored) return;

    try {
        const referrer = JSON.parse(stored) as UserProfile;
        
        const reward = currency === Currency.STARS 
            ? Math.floor(totalAmount * 0.07) 
            : parseFloat((totalAmount * 0.07).toFixed(4));
            
        referrer.referralStats.bonusBalance[currency] += reward;
        
        safeStorage.setItem(key, JSON.stringify(referrer));
        
        addLocalHistory(referrerId, {
            id: `m_ref_${Date.now()}_${Math.random()}`,
            type: 'referral_reward',
            assetType: 'currency',
            amount: reward,
            currency: currency,
            description: `Ref Reward (Lvl 1)`,
            timestamp: Date.now()
        });

        console.log(`[Mock] 💰 Sent ${reward} ${currency} to referrer ${referrerId}`);
    } catch (e) {
        console.error("Failed to distribute mock rewards", e);
    }
};

let FORCED_MOCK = false;

export const enableMockMode = () => {
    FORCED_MOCK = true;
    console.log("🛠️ Mock Mode Enabled");
};

// --- API HELPER ---
const apiRequest = async (endpoint: string, method: string = 'GET', body?: any) => {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const userId = tgUser?.id || 99999; 
  const username = tgUser?.username || "Guest";
  
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  
  let url = `${API_BASE}${endpoint}`;
  if (method === 'GET' && !url.includes('?')) {
      url += `?id=${userId}`;
  }

  const payload = body ? { id: userId, ...body } : { id: userId };

  // --- MOCK ENGINE ---
  const runMock = async () => {
        const user = getLocalState(userId, username);
        
        if (endpoint === '/auth') {
             const { startParam } = payload;
             if (!user.referrerId && startParam && startParam !== "none" && startParam !== user.referralCode) {
                 const realRefId = findUserIdByCode(startParam);
                 let fallbackId = null;
                 if (!realRefId && startParam.startsWith('ref_')) {
                     const parts = startParam.replace('ref_', '');
                     if (/^\d+$/.test(parts)) fallbackId = parseInt(parts);
                 }

                 const targetId = realRefId || fallbackId;

                 if (targetId && targetId !== user.id) {
                     user.referrerId = targetId;
                     user.referralDebug = `Mock: Bound to ${realRefId ? 'Real' : 'Legacy'} ID ${targetId}`;
                     
                     if (realRefId) {
                         const refKey = `mock_user_${realRefId}`;
                         const refDataStr = safeStorage.getItem(refKey);
                         if (refDataStr) {
                             const refData = JSON.parse(refDataStr);
                             refData.referralStats.level1 += 1;
                             safeStorage.setItem(refKey, JSON.stringify(refData));
                         }
                     }
                     updateLocalState(user);
                 } else {
                     user.referralDebug = `Mock: Code '${startParam}' not found`;
                 }
             }
             return user;
        }

        if (endpoint === '/roll') {
            if (user.diceBalance.available <= 0) throw new Error("No dice attempts left (Mock)");
            
            const isStarsRun = user.diceBalance.starsAttempts > 0;
            const roll = Math.floor(Math.random() * 6) + 1;
            
            user.diceBalance.available -= 1;
            if (isStarsRun) user.diceBalance.starsAttempts -= 1;

            if (roll > 0) { 
                user.nftBalance.total += roll; 
                if (isStarsRun) {
                    user.nftBalance.locked += roll;
                    user.nftBalance.lockedDetails.push({ amount: roll, unlockDate: Date.now() + (21 * 86400000) });
                } else {
                    user.nftBalance.available += roll; 
                }
            }
            
            addLocalHistory(userId, { 
                id: `m_${Date.now()}`, type: 'win', assetType: 'nft', amount: roll, 
                description: `Rolled ${roll}`, timestamp: Date.now(), isLocked: isStarsRun
            });
            
            updateLocalState(user);
            return { roll };
        }

        if (endpoint === '/history') return getLocalHistory(userId);
        
        if (endpoint === '/payment/create') { 
            const { type, amount, currency, useRewardBalance } = payload;
            
            const priceConfig = type === 'nft' ? NFT_PRICES : DICE_ATTEMPT_PRICES;
            const totalCost = (priceConfig[currency as Currency] || 0) * amount;
            let finalPayAmount = totalCost;

            if (useRewardBalance) {
                const currentReward = user.referralStats.bonusBalance[currency as Currency] || 0;
                const deduction = Math.min(currentReward, totalCost);
                finalPayAmount = totalCost - deduction;
                
                if (finalPayAmount <= 0) {
                     return { ok: true, isInternal: true };
                }
            }

            if (currency === 'STARS') {
                return { ok: true, invoiceLink: "https://t.me/$" };
            } else {
                let nano: string;
                if (currency === 'USDT') nano = "50000000"; 
                else nano = Math.floor(finalPayAmount * 1e9).toString();

                return { 
                    ok: true, 
                    transaction: {
                        validUntil: Math.floor(Date.now() / 1000) + 600,
                        messages: [{ 
                            address: "0QBycgJ7cxTLe4Y84HG6tOGQgf-284Es4zJzVJM8R2h1U_av", 
                            amount: nano 
                        }]
                    }
                };
            }
        }
        
        if (endpoint === '/payment/verify') { 
            const { type, amount, currency, useRewardBalance } = payload;
            const isStars = currency === 'STARS';

            const priceConfig = type === 'nft' ? NFT_PRICES : DICE_ATTEMPT_PRICES;
            const totalCost = (priceConfig[currency as Currency] || 0) * amount;
            let paidFromRewards = 0;
            let paidFromWallet = totalCost;

            // DEDUCT REWARDS
            if (useRewardBalance) {
                const currentReward = user.referralStats.bonusBalance[currency as Currency] || 0;
                paidFromRewards = Math.min(currentReward, totalCost);
                paidFromWallet = totalCost - paidFromRewards;

                user.referralStats.bonusBalance[currency as Currency] -= paidFromRewards;
                
                if (paidFromRewards > 0) {
                     addLocalHistory(userId, { 
                        id: `m_spend_${Date.now()}`, type: 'purchase', assetType: 'currency', 
                        amount: parseFloat(paidFromRewards.toFixed(4)), currency: currency, description: `Spent on ${type}`, 
                        timestamp: Date.now()
                    });
                }
            }

             if (type === 'nft') {
                 user.nftBalance.total += amount; 
                 if (isStars && paidFromWallet > 0) {
                     user.nftBalance.locked += amount;
                     user.nftBalance.lockedDetails.push({ amount, unlockDate: Date.now() + (21 * 86400000) });
                 } else {
                     user.nftBalance.available += amount;
                 }
             } else {
                 user.diceBalance.available += amount;
                 if (isStars && paidFromWallet > 0) {
                     user.diceBalance.starsAttempts += amount;
                 }
             }
             
             updateLocalState(user);

             if (paidFromWallet > 0 && user.referrerId) {
                 distributeMockRewards(user.referrerId, paidFromWallet, currency as Currency);
             }

             // --- DESCRIPTION FORMATTING (Wallet vs Bonus) ---
             let desc = `Purchase ${amount} ${type}`;
             if (paidFromRewards > 0) {
                 desc += ` (Wallet: ${paidFromWallet.toFixed(isStars?0:4)}, Bonus: ${paidFromRewards.toFixed(isStars?0:4)})`;
             } else {
                 desc += ` (Wallet: ${paidFromWallet.toFixed(isStars?0:4)})`;
             }

             addLocalHistory(userId, { 
                id: `m_pay_${Date.now()}`, type: 'purchase', assetType: type, 
                amount: amount, currency: currency, 
                description: desc, 
                timestamp: Date.now(), isLocked: (isStars && type === 'nft' && paidFromWallet > 0)
            });

             return { ok: true }; 
        }
        
        if (endpoint === '/withdraw') {
             const amt = user.nftBalance.available;
             if (amt <= 0) throw new Error("No funds");
             user.nftBalance.available = 0;
             user.nftBalance.total -= amt;
             addLocalHistory(userId, { id: `m_wd_${Date.now()}`, type: 'withdraw', assetType: 'nft', amount: amt, description: `Withdraw to ${payload.address}`, timestamp: Date.now() });
             updateLocalState(user);
             return { ok: true };
        }
        if (endpoint === '/debug/reset') { 
            const keys = [];
            for(let i=0; i<safeStorage.length(); i++) keys.push(safeStorage.key(i));
            keys.forEach(k => { if(k && k.startsWith('mock_')) safeStorage.removeItem(k); });
            return {ok:true}; 
        }
  };

  if (FORCED_MOCK) return runMock();

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000); 

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(payload) : undefined,
        signal: controller.signal
    });
    
    clearTimeout(id);
    const responseText = await response.text();
    let responseJson: any = null;
    try { if (responseText) responseJson = JSON.parse(responseText); } catch (e) {}

    if (!response.ok || response.status === 404 || response.status === 500) {
        throw new Error("Backend Error");
    }
    
    return responseJson || {};
  } catch (error: any) {
    console.warn(`⚠️ Backend unavailable (${error.message}). Switching to Mock.`);
    return runMock();
  }
};

export const fetchUserProfile = async (startParam?: string) => apiRequest('/auth', 'POST', { startParam });
export const fetchNftHistory = async () => apiRequest('/history');
export const createPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency, useRewardBalance: boolean = false) => apiRequest('/payment/create', 'POST', { type, amount, currency, useRewardBalance });
export const verifyPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency, useRewardBalance: boolean = false) => apiRequest('/payment/verify', 'POST', { type, amount, currency, useRewardBalance });
export const rollDice = async () => { const data = await apiRequest('/roll', 'POST'); return data.roll; };
export const withdrawNFTWithAddress = async (address: string) => apiRequest('/withdraw', 'POST', { address });
export const debugResetDb = async () => apiRequest('/debug/reset', 'POST');
