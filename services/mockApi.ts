import { UserProfile, Currency, NftTransaction, PaymentInitResponse } from '../types';

const API_BASE = '/api'; 

const getUserId = (): number => {
    // 1. Try Debug override
    const debugId = localStorage.getItem('debug_user_id');
    if (debugId) return parseInt(debugId, 10);

    // 2. Try Telegram
    if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
        return window.Telegram.WebApp.initDataUnsafe.user.id;
    }
    // 3. Fallback
    return 12345;
};

// --- API REQUEST WRAPPER ---
const apiRequest = async (endpoint: string, method: string = 'GET', body?: any) => {
  const userId = getUserId();
  
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
    if (!response.ok) throw new Error("Backend error " + response.status);
    return await response.json();
  } catch (error: any) {
    console.error("API Fail", error);
    throw error;
  }
};

export const debugResetDb = async (): Promise<void> => {
    await apiRequest('/debug/reset', 'POST');
};

export const fetchUserProfile = async (refId?: string): Promise<UserProfile> => {
    let url = '/user';
    if (refId) url += `?refId=${refId}`;
    return await apiRequest(url);
};

export const fetchNftHistory = async (): Promise<NftTransaction[]> => {
    return await apiRequest('/history');
};

export const createPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency): Promise<PaymentInitResponse> => {
    return await apiRequest('/payment/create', 'POST', { type, amount, currency });
};

export const verifyPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency, paymentProof?: string): Promise<boolean> => {
    return await apiRequest('/payment/verify', 'POST', { type, amount, currency });
};

export const rollDice = async (): Promise<number> => {
    const data = await apiRequest('/roll', 'POST');
    return data.roll;
};

export const withdrawNFTWithAddress = async (address: string): Promise<void> => {
    await apiRequest('/withdraw', 'POST', { address });
};