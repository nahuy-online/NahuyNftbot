
import { UserProfile, Currency, NftTransaction, PaymentInitResponse } from '../types';

const API_BASE = '/api'; 

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
    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(payload) : undefined
    });
    if (!response.ok) throw new Error("Backend error");
    return await response.json();
  } catch (error) {
    console.error("API Error:", error);
    // In a real app, you might want a local fallback here, 
    // but for this refactor, we rely on the backend being up.
    throw error;
  }
};

// --- EXPORTED FUNCTIONS ---

// 1. AUTH & LOAD PROFILE
// This is the new "Super Endpoint" that handles registration + referral binding
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
