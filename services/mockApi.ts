
import { UserProfile, Currency, NftTransaction, AdminStats, UserSortField } from '../types';
import { NFT_PRICES, DICE_ATTEMPT_PRICES } from '../constants';

// Detect API Target
// In development/docker, Vite proxies requests to /api
// In Render production, the backend is on a different domain, so we must use the full URL provided in build env.
// Use optional chaining to safely access VITE_API_URL even if import.meta.env is somehow undefined in certain contexts
const ENV_API_URL = (import.meta as any).env?.VITE_API_URL; // e.g., "https://nft-backend.onrender.com"

// If ENV_API_URL is not set, we default to '/api'.
// This indicates the frontend expects to be served by the same origin as the backend (Monolith setup).
const API_BASE = ENV_API_URL ? `${ENV_API_URL}/api` : '/api';

console.log(`[API Config] Target: ${ENV_API_URL || 'Relative Path (Same Origin)'}`);
console.log(`[API Config] Full Base URL: ${API_BASE}`);

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

// --- MOCK LOGIC HELPERS ---
// (Mock implementation details kept for explicit manual testing, but disabled by default)
const getNextSerialBatch = (qty: number): number[] => {
    const key = 'mock_global_serial_max';
    const currentMax = parseInt(safeStorage.getItem(key) || '0');
    const start = currentMax + 1;
    safeStorage.setItem(key, (currentMax + qty).toString());
    const batch = [];
    for(let i=0; i<qty; i++) batch.push(start+i);
    return batch;
};

const getLocalState = (userId: number, username: string) => {
    const key = `mock_user_${userId}`;
    const stored = safeStorage.getItem(key);
    if (stored) return JSON.parse(stored) as UserProfile;
    
    // Create new mock user with FAKE REFERRAL DATA to show off UI
    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padEnd(6, '0');
    const newUser: UserProfile = {
        id: userId, username, isAdmin: true, referralCode: `ref_${randomHex}`, referrerId: null,
        ip: '127.0.0.1', joinedAt: Date.now(), lastActive: Date.now(),
        nftBalance: { total: 0, available: 0, locked: 0, lockedDetails: [], withdrawn: 0 },
        reservedSerials: [],
        withdrawnSerials: [],
        diceBalance: { available: 5, starsAttempts: 0, used: 0 },
        referralStats: { 
            level1: 12, 
            level2: 5, 
            level3: 2, 
            lockedStars: 500, // Mock locked stars
            bonusBalance: { STARS: 1000, TON: 1.5, USDT: 45.0 } // Pre-filled bonus for demo (Available)
        }
    };
    safeStorage.setItem(key, JSON.stringify(newUser));
    return newUser;
};

const updateLocalState = (user: UserProfile) => safeStorage.setItem(`mock_user_${user.id}`, JSON.stringify(user));

const getLocalHistory = (userId: number): NftTransaction[] => {
    const key = `mock_history_${userId}`;
    return JSON.parse(safeStorage.getItem(key) || '[]');
};

const addLocalHistory = (userId: number, tx: NftTransaction) => {
    const hist = getLocalHistory(userId);
    hist.unshift(tx);
    safeStorage.setItem(`mock_history_${userId}`, JSON.stringify(hist));
};

let FORCED_MOCK = false;
export const enableMockMode = () => { FORCED_MOCK = true; console.log("🛠️ Mock Mode Enabled Manually"); };

// --- MAIN API REQUEST FUNCTION ---
const apiRequest = async (endpoint: string, method: string = 'GET', body?: any) => {
  // 1. Get Telegram Init Data for Security
  const initData = window.Telegram?.WebApp?.initData || '';
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  
  // Fallback for local browser testing without Telegram
  const userId = tgUser?.id || 99999; 
  const username = tgUser?.username || "Guest";
  
  const headers: HeadersInit = { 
      'Content-Type': 'application/json',
      'Authorization': `tma ${initData}` 
  };
  
  let url = `${API_BASE}${endpoint}`;
  // Append ID for local mock dev only if using basic Auth
  if (method === 'GET' && !url.includes('?') && !initData) {
      url += `?id=${userId}`; 
  }

  const payload = body ? { id: userId, ...body } : { id: userId };

  // --- MOCK HANDLER ---
  const runMock = async () => {
        console.warn(`[MockApi] Executing ${method} ${endpoint} (Local Mode)`);
        const user = getLocalState(userId, username);
        
        if (endpoint === '/auth') return user;
        
        if (endpoint === '/roll') {
            if (user.diceBalance.available <= 0) throw new Error("No dice attempts left (Mock)");
            const roll = Math.floor(Math.random() * 6) + 1;
            user.diceBalance.available -= 1;
            
            let rolledSerials: number[] = [];
            if (roll > 0) { 
                user.nftBalance.total += roll; 
                user.nftBalance.available += roll;
                rolledSerials = getNextSerialBatch(roll);
                if (!user.reservedSerials) user.reservedSerials = [];
                user.reservedSerials.push(...rolledSerials);
            }
            addLocalHistory(userId, { 
                id: `m_${Date.now()}`, type: 'win', assetType: 'nft', amount: roll, 
                description: `Rolled ${roll}`, timestamp: Date.now(), serials: rolledSerials
            });
            updateLocalState(user);
            return { roll };
        }
        
        if (endpoint === '/history') return getLocalHistory(userId);
        
        if (endpoint === '/withdraw') {
             const amt = user.nftBalance.available;
             if (amt <= 0) throw new Error("No funds");
             user.nftBalance.available = 0;
             user.nftBalance.total -= amt;
             user.nftBalance.withdrawn = (user.nftBalance.withdrawn || 0) + amt;
             if(user.reservedSerials) {
                 const withdrawn = user.reservedSerials.splice(0, amt);
                 if(!user.withdrawnSerials) user.withdrawnSerials = [];
                 user.withdrawnSerials.push(...withdrawn);
             }
             addLocalHistory(userId, { id: `m_wd_${Date.now()}`, type: 'withdraw', assetType: 'nft', amount: amt, description: `Withdraw`, timestamp: Date.now() });
             updateLocalState(user);
             return { ok: true };
        }
        
        if (endpoint === '/payment/create') {
            return { ok: true, internalId: 'mock_tx', transaction: null };
        }
        
        if (endpoint === '/payment/verify') {
             // 1. Grant Asset
             if (payload.type === 'dice') user.diceBalance.available += payload.amount;
             else user.nftBalance.total += payload.amount;
             
             // 2. SIMULATE REFERRAL REWARD (Self-reward for testing visuals)
             // In real app, this goes to upline. In mock, we give it to self to see the balance change.
             const prices = payload.type === 'nft' ? NFT_PRICES : DICE_ATTEMPT_PRICES;
             const cost = prices[payload.currency as Currency] * payload.amount;
             const mockReward = cost * 0.11; // 11%

             if (payload.currency === 'STARS') {
                 // Mock Locked Stars
                 user.referralStats.lockedStars = (user.referralStats.lockedStars || 0) + Math.floor(mockReward);
                 // Don't add to available
             }
             else if (payload.currency === 'TON') user.referralStats.bonusBalance.TON += mockReward;
             else user.referralStats.bonusBalance.USDT += mockReward;

             // Log purchase
             addLocalHistory(userId, { 
                id: `m_buy_${Date.now()}`, type: 'purchase', assetType: payload.type, 
                amount: payload.amount, currency: payload.currency, 
                description: `Mock Purchase`, timestamp: Date.now() 
             });

             // Log fake reward
             addLocalHistory(userId, {
                 id: `m_ref_${Date.now()}`, type: 'referral_reward', assetType: 'currency',
                 amount: parseFloat(mockReward.toFixed(4)), currency: payload.currency,
                 description: `Simulated Ref Reward`, timestamp: Date.now(),
                 isLocked: payload.currency === 'STARS'
             });

             updateLocalState(user);
             return { ok: true };
        }

        if (endpoint === '/debug/seize') {
            const { assetType, targetId } = payload;
            const targetUser = getLocalState(targetId, 'User');
            
            if (assetType === 'dice') {
                targetUser.diceBalance.available = 0;
            } else {
                targetUser.nftBalance.locked = 0;
                // Simplified mock seize
            }
            
            updateLocalState(targetUser);
            addLocalHistory(targetId, {
                id: `m_seize_${Date.now()}`, type: 'seizure', assetType, amount: 0,
                description: `Seized ${assetType}`, timestamp: Date.now()
            });
            return { ok: true, message: `Mock seized ${assetType}` };
        }
        
        if (endpoint === '/admin/search') {
            // Mock Search by ID or Username
            const targetId = payload.targetId;
            // In Mock, we only have the current user in session + whatever is in localstorage
            // We just return current user for testing if ID matches or 99999
            if (targetId == userId || targetId == 99999) {
                return {
                    found: true,
                    user: {
                        id: user.id, username: user.username, nftTotal: user.nftBalance.total,
                        nftAvailable: user.nftBalance.available, diceAvailable: user.diceBalance.available,
                        transactions: getLocalHistory(user.id),
                        rewards: user.referralStats.bonusBalance,
                        referralStats: { level1: 0, level2: 0, level3: 0 }
                    }
                };
            }
            return { found: false };
        }

        return { ok: true };
  };

  if (FORCED_MOCK) return runMock();

  try {
    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(payload) : undefined
    });
    
    // Parse response regardless of status to extract error details
    const responseText = await response.text();
    let responseJson: any = null;
    try { if (responseText) responseJson = JSON.parse(responseText); } catch (e) {}

    if (!response.ok) {
        // Construct a very clear error message
        const statusText = response.statusText ? `(${response.statusText})` : '';
        const errorMessage = responseJson?.error || `Server Error ${response.status} ${statusText}`;
        throw new Error(errorMessage);
    }
    
    return responseJson || {};
  } catch (error: any) {
    console.error(`[ApiRequest] Error connecting to ${url}: ${error.message}`);
    throw error;
  }
};

export const fetchUserProfile = async (startParam?: string) => apiRequest('/auth', 'POST', { startParam });
export const fetchNftHistory = async () => apiRequest('/history');
export const createPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency, useRewardBalance: boolean = false) => apiRequest('/payment/create', 'POST', { type, amount, currency, useRewardBalance });
export const verifyPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency, useRewardBalance: boolean = false) => apiRequest('/payment/verify', 'POST', { type, amount, currency, useRewardBalance });
export const rollDice = async () => { const data = await apiRequest('/roll', 'POST'); return data.roll; };
export const withdrawNFTWithAddress = async (address: string) => apiRequest('/withdraw', 'POST', { address });
export const debugResetDb = async () => apiRequest('/debug/reset', 'POST');
export const debugSeizeAsset = async (assetType: 'nft' | 'dice' = 'nft', targetId?: number) => apiRequest('/debug/seize', 'POST', { assetType, targetId });

// Admin
export const fetchAdminStats = async () => apiRequest('/admin/stats', 'POST');
export const searchAdminUser = async (targetId: number | string) => apiRequest('/admin/search', 'POST', { targetId });
export const fetchAdminUsers = async (sortBy: UserSortField, sortOrder: 'asc'|'desc', limit: number, offset: number) => apiRequest('/admin/users', 'POST', { sortBy, sortOrder, limit, offset });
