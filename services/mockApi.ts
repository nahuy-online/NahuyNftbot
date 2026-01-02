
import { UserProfile, Currency, NftTransaction } from '../types';
import { NFT_PRICES, DICE_ATTEMPT_PRICES } from '../constants';

const API_BASE = '/api'; 

// --- SAFE STORAGE WRAPPER (Handles SecurityError in iframes) ---
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

    // Generate random mock code with ref_ prefix
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
        referralStats: { level1: 0, level2: 0, level3: 0, earnings: { STARS: 0, TON: 0, USDT: 0 } }
    };
    safeStorage.setItem(key, JSON.stringify(newUser));
    return newUser;
};

const updateLocalState = (user: UserProfile) => {
    safeStorage.setItem(`mock_user_${user.id}`, JSON.stringify(user));
};

// HELPER: Find a user ID in storage by their referral code
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

// HELPER: Distribute Rewards to Referrer in Storage
const distributeMockRewards = (referrerId: number, totalAmount: number, currency: Currency) => {
    const key = `mock_user_${referrerId}`;
    const stored = safeStorage.getItem(key);
    if (!stored) return;

    try {
        const referrer = JSON.parse(stored) as UserProfile;
        
        // Level 1 Reward (7%)
        const reward = currency === Currency.STARS 
            ? Math.floor(totalAmount * 0.07) 
            : parseFloat((totalAmount * 0.07).toFixed(4));
            
        referrer.referralStats.earnings[currency] += reward;
        
        safeStorage.setItem(key, JSON.stringify(referrer));
        
        // Add transaction record for referrer
        addLocalHistory(referrerId, {
            id: `m_ref_${Date.now()}`,
            type: 'referral',
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
             
             // Try to bind if not bound
             if (!user.referrerId && startParam && startParam !== "none" && startParam !== user.referralCode) {
                 const realRefId = findUserIdByCode(startParam);
                 // Fallback legacy ID check
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
            
            // Check if paying with rewards
            if (useRewardBalance) {
                const priceConfig = type === 'nft' ? NFT_PRICES : DICE_ATTEMPT_PRICES;
                const cost = (priceConfig[currency as Currency] || 0) * amount;
                
                if (user.referralStats.earnings[currency as Currency] < cost) {
                    return { ok: false, error: "Insufficient reward balance" };
                }
                
                // Return success immediately for internal payment
                return { ok: true, isInternal: true };
            }

            // Normal external payment
            if (currency === 'STARS') {
                return { ok: true, invoiceLink: "https://t.me/$" };
            } else {
                const priceConfig = type === 'nft' ? NFT_PRICES : DICE_ATTEMPT_PRICES;
                const total = (priceConfig[currency as Currency] || 0) * amount;
                const nano = Math.floor(total * 1e9).toString();
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

            // IF Paying with Rewards, deduct balance
            if (useRewardBalance) {
                const priceConfig = type === 'nft' ? NFT_PRICES : DICE_ATTEMPT_PRICES;
                const cost = (priceConfig[currency as Currency] || 0) * amount;
                
                // Double check (backend side validation simulation)
                if (user.referralStats.earnings[currency as Currency] < cost) {
                    throw new Error("Insufficient reward balance");
                }
                
                user.referralStats.earnings[currency as Currency] -= cost;
                
                // Add spending record
                 addLocalHistory(userId, { 
                    id: `m_spend_${Date.now()}`, type: 'purchase', assetType: 'currency', 
                    amount: cost, currency: currency, description: `Spent Rewards on ${type}`, 
                    timestamp: Date.now()
                });
            }

             // Update Balance
             if (type === 'nft') {
                 user.nftBalance.total += amount; 
                 // Items bought with rewards are NOT locked unless currency was Stars (policy optional, let's say rewards are clean)
                 // Actually, if bought with Stars Rewards, still Stars policy applies? 
                 // Let's assume Rewards = Clean for simplicity, except Stars might be locked. 
                 // For now: Reward purchase = No lock.
                 user.nftBalance.available += amount;
             } else {
                 user.diceBalance.available += amount;
                 // Reward purchase does not add to "starsAttempts" (locked attempts)
             }
             
             updateLocalState(user);

             // DISTRIBUTE REWARDS (Only if paid with real money, OR we can decide rewards generate rewards. 
             // Usually Internal spending DOES NOT generate upline rewards to prevent loop.
             if (!useRewardBalance && user.referrerId) {
                 const priceMap = type === 'nft' ? NFT_PRICES : DICE_ATTEMPT_PRICES;
                 const pricePerUnit = priceMap[currency as Currency] || 0;
                 const totalSpent = pricePerUnit * amount;
                 distributeMockRewards(user.referrerId, totalSpent, currency as Currency);
             }

             addLocalHistory(userId, { 
                id: `m_pay_${Date.now()}`, type: 'purchase', assetType: type, 
                amount: amount, currency: currency, description: `Purchase ${amount} ${type}`, 
                timestamp: Date.now(), isLocked: false 
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
    // Short timeout for preview environments to fail faster
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
    // ALWAYS fallback to Mock in dev/preview if fetch fails
    console.warn(`⚠️ Backend unavailable (${error.message}). Switching to Mock.`);
    return runMock();
  }
};

export const fetchUserProfile = async (startParam?: string) => apiRequest('/auth', 'POST', { startParam });
export const fetchNftHistory = async () => apiRequest('/history');
// Updated signature to support reward balance
export const createPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency, useRewardBalance: boolean = false) => apiRequest('/payment/create', 'POST', { type, amount, currency, useRewardBalance });
export const verifyPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency, useRewardBalance: boolean = false) => apiRequest('/payment/verify', 'POST', { type, amount, currency, useRewardBalance });
export const rollDice = async () => { const data = await apiRequest('/roll', 'POST'); return data.roll; };
export const withdrawNFTWithAddress = async (address: string) => apiRequest('/withdraw', 'POST', { address });
export const debugResetDb = async () => apiRequest('/debug/reset', 'POST');
