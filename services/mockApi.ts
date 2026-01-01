
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

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(payload) : undefined,
        signal: controller.signal
    });
    
    clearTimeout(id);

    // CRITICAL FIX: If 500 (Server Error), THROW IT so we see the real backend bug.
    // Only fallback to mock if 404 (Not Found/No Proxy) or Network Error.
    if (response.status === 500) {
        const errText = await response.text();
        throw new Error(`SERVER ERROR (500): ${errText}`);
    }

    if (response.status === 503) {
        throw new Error("Server is initializing...");
    }
    
    // Fallback trigger for 404 (Running locally without docker backend)
    if (response.status === 404) {
        throw new Error("MOCK_FALLBACK");
    }
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Backend error: ${text}`);
    }
    
    return await response.json();
  } catch (error: any) {
    // Only use Mock if we CANNOT reach the server or if explicitly 404 (Preview mode)
    // If the server replies 500, we want to see it!
    const isNetworkError = error.message === "MOCK_FALLBACK" || 
                           error.name === 'AbortError' || 
                           error.message.includes("Failed to fetch") ||
                           error.message.includes("NetworkError");

    if (isNetworkError) {
        console.warn(`⚠️ Backend Unreachable (${endpoint}). Using Local Mock Data.`);
        
        // --- MOCK LOGIC (Simplified for brevity, same as before) ---
        const user = getLocalState(userId, username);
        if (endpoint === '/auth') return user;
        if (endpoint === '/roll') {
            if (user.diceBalance.available <= 0) throw new Error("No dice attempts left (Mock)");
            const roll = Math.floor(Math.random() * 6) + 1;
            user.diceBalance.available -= 1;
            if (roll > 0) { user.nftBalance.total += roll; user.nftBalance.available += roll; }
            localStorage.setItem(`mock_user_${userId}`, JSON.stringify(user));
            return { roll };
        }
        if (endpoint === '/history') return [];
        if (endpoint === '/payment/create') return { ok: true, invoiceLink: "https://t.me/$" };
        if (endpoint === '/payment/verify') { return { ok: true }; }
        if (endpoint === '/withdraw') return { ok: true };
    }
    
    // Throw real errors (like 500) to the UI
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
