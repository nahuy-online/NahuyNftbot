
import { UserProfile, Currency, NftTransaction, PaymentInitResponse } from '../types';

const API_BASE = '/api'; 

// --- FALLBACK DATA FOR PREVIEW / DEMO ---
const MOCK_USER: UserProfile = {
    id: 12345,
    username: "DemoUser",
    referralCode: "demo_ref",
    referrerId: null,
    nftBalance: {
        total: 15,
        available: 10,
        locked: 5,
        lockedDetails: [{ amount: 5, unlockDate: Date.now() + 864000000 }]
    },
    diceBalance: {
        available: 3,
        starsAttempts: 0,
        used: 0
    },
    referralStats: {
        level1: 5,
        level2: 2,
        level3: 0,
        earnings: { STARS: 100, TON: 0.5, USDT: 10 }
    }
};

// --- API HELPER ---
const apiRequest = async (endpoint: string, method: string = 'GET', body?: any) => {
  // Get Telegram ID
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const userId = tgUser?.id || 12345; // Fallback for browser
  
  const headers: HeadersInit = { 
      'Content-Type': 'application/json'
  };
  
  // Some endpoints need ID in query for GET
  let url = `${API_BASE}${endpoint}`;
  if (method === 'GET' && !url.includes('?')) {
      url += `?id=${userId}`;
  }

  // Include ID in body for POST automatically if not present
  const payload = body ? { id: userId, ...body } : { id: userId };

  try {
    const controller = new AbortController();
    // Short timeout for fallback check
    const id = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(payload) : undefined,
        signal: controller.signal
    });
    
    clearTimeout(id);

    // If 503 (Starting) or 500 (Crash) or 404 (No backend in Preview), use Mock Data
    if (response.status === 503 || response.status === 500 || response.status === 404) {
        console.warn(`Backend responded with ${response.status}. Switching to Mock Data for Preview.`);
        throw new Error("MOCK_FALLBACK");
    }
    
    if (!response.ok) {
        const text = await response.text();
        let errMsg = `Backend error (${response.status})`;
        try {
            const json = JSON.parse(text);
            if (json.error) errMsg = json.error;
        } catch (e) {
            if(text.length < 100) errMsg += `: ${text}`;
        }
        throw new Error(errMsg);
    }
    
    return await response.json();
  } catch (error: any) {
    // --- MOCK FALLBACK LOGIC ---
    if (error.message === "MOCK_FALLBACK" || error.name === 'AbortError' || error.message.includes("Failed to fetch")) {
        console.log("⚠️ API Unavailable. Returning Demo Data.");
        
        // Simulate specific endpoint responses
        if (endpoint === '/auth') return MOCK_USER;
        if (endpoint === '/history') return [];
        if (endpoint === '/roll') return { roll: Math.floor(Math.random() * 6) + 1 };
        if (endpoint === '/payment/create') return { ok: true, invoiceLink: "https://t.me/$" };
        if (endpoint === '/payment/verify') return { ok: true };
        if (endpoint === '/withdraw') return { ok: true };
    }
    
    console.error("API Error:", error);
    throw error;
  }
};

// --- EXPORTED FUNCTIONS ---

export const fetchUserProfile = async (startParam?: string): Promise<UserProfile> => {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    const username = tgUser?.username || "Guest";
    const id = tgUser?.id || 12345;

    // Call the unified Auth endpoint
    return await apiRequest('/auth', 'POST', { 
        id, 
        username, 
        startParam: startParam || "none" 
    });
};

export const fetchNftHistory = async (): Promise<NftTransaction[]> => {
    return await apiRequest('/history');
};

export const createPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency): Promise<PaymentInitResponse> => {
    return await apiRequest('/payment/create', 'POST', { type, amount, currency });
};

export const verifyPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency): Promise<boolean> => {
    return await apiRequest('/payment/verify', 'POST', { type, amount, currency });
};

export const rollDice = async (): Promise<number> => {
    const data = await apiRequest('/roll', 'POST');
    return data.roll;
};

export const withdrawNFTWithAddress = async (address: string): Promise<void> => {
    await apiRequest('/withdraw', 'POST', { address });
};

export const debugResetDb = async (): Promise<void> => {
    await apiRequest('/debug/reset', 'POST');
};
