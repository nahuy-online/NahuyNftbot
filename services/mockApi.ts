
import { UserProfile, Currency, NftTransaction, PaymentInitResponse } from '../types';

const API_BASE = '/api'; 

// --- STATEFUL MOCK ENGINE (LOCAL STORAGE) ---
const getLocalState = (userId: number, username: string) => {
    const key = `mock_user_${userId}`;
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as UserProfile;

    const newUser: UserProfile = {
        id: userId,
        username: username,
        referralCode: `ref_${userId}`,
        referrerId: null,
        nftBalance: { total: 0, available: 0, locked: 0, lockedDetails: [] },
        diceBalance: { available: 2, starsAttempts: 0, used: 0 },
        referralStats: { level1: 0, level2: 0, level3: 0, earnings: { STARS: 0, TON: 0, USDT: 0 } }
    };
    localStorage.setItem(key, JSON.stringify(newUser));
    return newUser;
};

const updateLocalState = (user: UserProfile) => {
    localStorage.setItem(`mock_user_${user.id}`, JSON.stringify(user));
};

const getLocalHistory = (userId: number): NftTransaction[] => {
    const key = `mock_history_${userId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
};

const addLocalHistory = (userId: number, tx: NftTransaction) => {
    const hist = getLocalHistory(userId);
    hist.unshift(tx);
    localStorage.setItem(`mock_history_${userId}`, JSON.stringify(hist));
};

let FORCED_MOCK = false;

export const enableMockMode = () => {
    FORCED_MOCK = true;
    console.log("🛠️ Mock Mode Enabled by User");
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

  // --- CHECK MOCK TRIGGER ---
  const runMock = async () => {
        const user = getLocalState(userId, username);
        if (endpoint === '/auth') return user;
        if (endpoint === '/roll') {
            if (user.diceBalance.available <= 0) throw new Error("No dice attempts left (Mock)");
            const roll = Math.floor(Math.random() * 6) + 1;
            user.diceBalance.available -= 1;
            if (roll > 0) { user.nftBalance.total += roll; user.nftBalance.available += roll; }
            
            addLocalHistory(userId, { id: `m_${Date.now()}`, type: 'win', assetType: 'nft', amount: roll, description: `Rolled ${roll}`, timestamp: Date.now() });
            
            updateLocalState(user);
            return { roll };
        }
        if (endpoint === '/history') return getLocalHistory(userId);
        if (endpoint === '/payment/create') return { ok: true, invoiceLink: "https://t.me/$" };
        if (endpoint === '/payment/verify') { 
            const { type, amount, currency } = payload;
             if (type === 'nft') user.nftBalance.total += amount; 
             else user.diceBalance.available += amount;
             updateLocalState(user);
             return { ok: true }; 
        }
        if (endpoint === '/withdraw') return { ok: true };
        if (endpoint === '/debug/reset') { localStorage.clear(); return {ok:true}; }
  };

  if (FORCED_MOCK) return runMock();

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(payload) : undefined,
        signal: controller.signal
    });
    
    clearTimeout(id);

    // FIX: Read text first to safely handle non-JSON or empty bodies
    const responseText = await response.text();
    let responseJson: any = null;
    
    try {
        if (responseText) responseJson = JSON.parse(responseText);
    } catch (e) {
        // Not JSON
    }

    if (response.status === 500) {
        // If 500 and empty text, it's likely a proxy error (ECONNREFUSED)
        const errMsg = responseJson?.error || responseText || "Connection Refused (Proxy Error)";
        throw new Error(`SERVER ERROR (500): ${errMsg}`);
    }

    if (response.status === 502 || response.status === 504) {
        throw new Error("Gateway Timeout / Bad Gateway");
    }

    if (response.status === 503) throw new Error("Server is initializing (DB)...");
    if (response.status === 404) throw new Error("MOCK_FALLBACK"); 
    
    if (!response.ok) {
        throw new Error(`Backend error: ${responseJson?.error || responseText}`);
    }
    
    return responseJson || {};
  } catch (error: any) {
    const isNetworkError = error.message === "MOCK_FALLBACK" || 
                           error.name === 'AbortError' || 
                           error.message.includes("Failed to fetch") ||
                           error.message.includes("NetworkError") ||
                           error.message.includes("ECONNREFUSED") ||
                           error.message.includes("Connection Refused");

    if (isNetworkError) {
        console.warn(`⚠️ Backend Unreachable (${endpoint}). Using Local Mock Data.`);
        return runMock();
    }
    throw error;
  }
};

export const fetchUserProfile = async (startParam?: string) => apiRequest('/auth', 'POST', { startParam });
export const fetchNftHistory = async () => apiRequest('/history');
export const createPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency) => apiRequest('/payment/create', 'POST', { type, amount, currency });
export const verifyPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency) => apiRequest('/payment/verify', 'POST', { type, amount, currency });
export const rollDice = async () => { const data = await apiRequest('/roll', 'POST'); return data.roll; };
export const withdrawNFTWithAddress = async (address: string) => apiRequest('/withdraw', 'POST', { address });
export const debugResetDb = async () => apiRequest('/debug/reset', 'POST');
