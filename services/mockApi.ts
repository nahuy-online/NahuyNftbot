import { UserProfile, Currency, NftTransaction, PaymentInitResponse } from '../types';

const API_BASE = '/api'; 

// --- API REQUEST WRAPPER ---
const apiRequest = async (endpoint: string, method: string = 'GET', body?: any) => {
  // Get User ID from Telegram or fallback to a debug ID for local browser testing
  const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 12345;
  
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
  // Append ID to GET requests for easier backend debugging
  const queryPart = url.includes('?') ? `&id=${userId}` : `?id=${userId}`;
  
  if (method === 'GET') {
      url += queryPart;
  }

  try {
    const response = await fetch(url, config);
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend Error ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (error: any) {
    console.error("❌ API Request Failed:", url, error);
    // Rethrow to stop the app or show error UI, instead of silently using mock data
    throw error;
  }
};

// --- REAL API CALLS ---

export const debugResetDb = async (): Promise<void> => {
    await apiRequest('/debug/reset', 'POST');
};

export const fetchUserProfile = async (refId?: string, register: boolean = false): Promise<UserProfile> => {
    let url = '/user';
    const params = [];
    if (refId) params.push(`refId=${refId}`);
    if (register) params.push(`register=true`);
    
    if (params.length > 0) url += `?${params.join('&')}`;
    
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
