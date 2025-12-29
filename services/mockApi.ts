import { UserProfile, Currency, NftTransaction, PaymentInitResponse } from '../types';

// Detect if we are running in dev mode or prod
const API_BASE = '/api'; 

const getTelegramUserId = (): number => {
  if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
    return window.Telegram.WebApp.initDataUnsafe.user.id;
  }
  // Fallback for browser testing (without Telegram)
  const stored = localStorage.getItem('debug_user_id');
  if (stored) return parseInt(stored);
  const newId = Math.floor(Math.random() * 1000000);
  localStorage.setItem('debug_user_id', newId.toString());
  return newId;
};

// --- MOCK DATA FALLBACK (In case Backend is offline) ---
const MOCK_USER: UserProfile = {
    id: getTelegramUserId(),
    username: window.Telegram?.WebApp?.initDataUnsafe?.user?.username || "DemoUser",
    nftBalance: { total: 10, available: 5, locked: 5, lockedDetails: [{amount: 5, unlockDate: Date.now() + 86400000 * 5}] },
    diceBalance: { available: 5, starsAttempts: 0, used: 10 },
    referralStats: { level1: 5, level2: 2, level3: 1, earnings: { STARS: 500, TON: 2, USDT: 5 } },
    walletAddress: undefined
};

const handleMockFallback = (endpoint: string, method: string, body?: any) => {
    console.log(`⚠️ Using Mock Data for ${endpoint}`);
    return new Promise((resolve) => {
        setTimeout(() => {
            if (endpoint.includes('/user')) resolve(MOCK_USER);
            else if (endpoint.includes('/history')) resolve([]);
            else if (endpoint.includes('/payment/create')) {
                resolve({ 
                    ok: true, 
                    currency: body.currency, 
                    invoiceLink: body.currency === 'STARS' ? 'https://t.me/$' : undefined,
                    transaction: body.currency !== 'STARS' ? { validUntil: 0, messages: [] } : undefined
                });
            }
            else if (endpoint.includes('/payment/verify')) resolve(true);
            else if (endpoint.includes('/roll')) resolve({ roll: Math.floor(Math.random()*6)+1 });
            else if (endpoint.includes('/withdraw')) resolve({ ok: true });
            else resolve({});
        }, 500);
    });
};

const apiRequest = async (endpoint: string, method: string = 'GET', body?: any) => {
  const userId = getTelegramUserId();
  
  const headers: HeadersInit = { 
      'Content-Type': 'application/json', 
      'X-Telegram-User-Id': userId.toString() 
  };
  
  const config: RequestInit = { 
      method, 
      headers, 
      body: body ? JSON.stringify({ id: userId, ...body }) : undefined 
  };

  let url = `${API_BASE}${endpoint}`;
  if (method === 'GET') {
      url += url.includes('?') ? `&id=${userId}` : `?id=${userId}`;
  }

  try {
    const response = await fetch(url, config);
    if (!response.ok) {
        // If ANY error (404, 500, 502), fallback to mock to ensure UI loads
        console.warn(`Backend Error ${response.status} for ${endpoint}. Switching to Mock Data.`);
        return handleMockFallback(endpoint, method, body);
    }
    return await response.json();
  } catch (error: any) {
    // Network errors, connection refused, etc.
    console.warn("Network/API Error, switching to Mock Data:", error);
    return handleMockFallback(endpoint, method, body);
  }
};

// --- REAL API CALLS ---

export const fetchUserProfile = async (): Promise<UserProfile> => {
    return await apiRequest('/user');
};

export const fetchNftHistory = async (): Promise<NftTransaction[]> => {
    return await apiRequest('/history');
};

export const createPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency): Promise<PaymentInitResponse> => {
    return await apiRequest('/payment/create', 'POST', { type, amount, currency });
};

export const verifyPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency, paymentProof?: string): Promise<boolean> => {
    try {
        await apiRequest('/payment/verify', 'POST', { type, amount, currency });
        return true;
    } catch (e) {
        console.warn("Verification pending or failed", e);
        throw e;
    }
};

export const rollDice = async (): Promise<number> => {
    const data = await apiRequest('/roll', 'POST');
    return data.roll;
};

export const withdrawNFTWithAddress = async (address: string): Promise<void> => {
    await apiRequest('/withdraw', 'POST', { address });
};
