
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
    // Timeout extended to 15s to handle initial container spin-up (migrations)
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(payload) : undefined,
        signal: controller.signal
    });
    
    clearTimeout(id);

    if (response.status === 503) {
        throw new Error("Server starting up... Please retry.");
    }
    
    if (!response.ok) {
        // Try to read JSON error message from backend
        const text = await response.text();
        let errMsg = `Backend error (${response.status})`;
        try {
            const json = JSON.parse(text);
            if (json.error) errMsg = json.error;
        } catch (e) {
            // If not JSON, use the status text
            if(text.length < 100) errMsg += `: ${text}`;
        }
        throw new Error(errMsg);
    }
    
    return await response.json();
  } catch (error: any) {
    console.error("API Error:", error);
    if (error.name === 'AbortError') {
        throw new Error("Connection timed out. Server might be sleeping.");
    }
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
