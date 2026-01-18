
import { UserProfile, Currency, NftTransaction, AdminStats, UserSortField } from '../types';
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
    
    // Create new mock user
    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padEnd(6, '0');
    const newUser: UserProfile = {
        id: userId, username, isAdmin: true, referralCode: `ref_${randomHex}`, referrerId: null,
        ip: '127.0.0.1', joinedAt: Date.now(), lastActive: Date.now(),
        nftBalance: { total: 0, available: 0, locked: 0, lockedDetails: [] },
        reservedSerials: [],
        diceBalance: { available: 5, starsAttempts: 0, used: 0 },
        referralStats: { level1: 0, level2: 0, level3: 0, bonusBalance: { STARS: 0, TON: 0, USDT: 0 } }
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
  if (method === 'GET' && !url.includes('?')) {
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
             if(user.reservedSerials) user.reservedSerials.splice(0, amt);
             addLocalHistory(userId, { id: `m_wd_${Date.now()}`, type: 'withdraw', assetType: 'nft', amount: amt, description: `Withdraw`, timestamp: Date.now() });
             updateLocalState(user);
             return { ok: true };
        }
        
        if (endpoint === '/payment/create') {
            return { ok: true, internalId: 'mock_tx', transaction: null };
        }
        
        if (endpoint === '/payment/verify') {
             if (payload.type === 'dice') user.diceBalance.available += payload.amount;
             else user.nftBalance.total += payload.amount;
             updateLocalState(user);
             return { ok: true };
        }

        return { ok: true };
  };

  // 🚨 CRITICAL CHANGE: NO AUTOMATIC FALLBACK
  // Only run mock if explicitly enabled by user/dev
  if (FORCED_MOCK) return runMock();

  try {
    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(payload) : undefined
    });
    
    const responseText = await response.text();
    let responseJson: any = null;
    try { if (responseText) responseJson = JSON.parse(responseText); } catch (e) {}

    if (!response.ok) {
        throw new Error(responseJson?.error || `Server Error ${response.status}`);
    }
    
    return responseJson || {};
  } catch (error: any) {
    // ⚠️ Previously this silently swallowed errors and switched to Mock.
    // Now we rethrow the error so the UI shows "Connection Error".
    console.error(`[ApiRequest] Error: ${error.message}`);
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
export const searchAdminUser = async (targetId: number) => apiRequest('/admin/search', 'POST', { targetId });
export const fetchAdminUsers = async (sortBy: UserSortField, sortOrder: 'asc'|'desc', limit: number, offset: number) => apiRequest('/admin/users', 'POST', { sortBy, sortOrder, limit, offset });
