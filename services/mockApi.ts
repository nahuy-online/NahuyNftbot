import { UserProfile, Currency } from '../types';

// Use local backend for dev, production URL for live
const API_URL = 'http://localhost:8080/api'; 

// --- MOCK STATE FOR OFFLINE/DEMO MODE ---
let mockUser: UserProfile = {
  id: 123456789,
  username: "DemoUser",
  nftBalance: {
    total: 10,
    available: 5,
    locked: 5,
    lockedDetails: [
        { amount: 5, unlockDate: Date.now() + 86400000 * 21 } // Unlock in 21 days
    ]
  },
  diceBalance: {
    available: 5,
    starsAttempts: 0,
    used: 12
  },
  referralStats: {
    level1: 5,
    level2: 2,
    level3: 1,
    earnings: { STARS: 500, TON: 10, USDT: 50 }
  },
  walletAddress: ""
};

// Helper to get the Telegram User ID securely
const getTelegramUserId = (): number => {
  // Fallback for local browser testing without Telegram context
  if (!window.Telegram?.WebApp?.initDataUnsafe?.user) {
    return 123456789; 
  }
  return window.Telegram.WebApp.initDataUnsafe.user.id;
};

// Helper for authorized fetch requests
const apiRequest = async (endpoint: string, method: string = 'GET', body?: any) => {
  const userId = getTelegramUserId();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'X-Telegram-User-Id': userId.toString(), 
  };

  const config: RequestInit = {
    method,
    headers,
    body: body ? JSON.stringify({ id: userId, ...body }) : undefined,
  };

  let url = `${API_URL}${endpoint}`;
  if (method === 'GET') {
    url += `?id=${userId}`;
  }

  const response = await fetch(url, config);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API Error: ${response.status}`);
  }

  return response.json();
};

export const fetchUserProfile = async (): Promise<UserProfile> => {
  try {
    return await apiRequest('/user');
  } catch (error) {
    console.warn("Backend unreachable (Failed to fetch). Switching to Mock Mode.", error);
    // Return a copy of the mock state
    return JSON.parse(JSON.stringify(mockUser));
  }
};

export const connectWallet = async (): Promise<string> => {
  return ""; 
};

export const purchaseItem = async (type: 'nft' | 'dice', amount: number, currency: Currency): Promise<boolean> => {
  try {
    await apiRequest('/buy', 'POST', { type, amount, currency });
    return true;
  } catch (error) {
    console.warn("Backend unreachable. Simulating Purchase.", error);
    
    // Update Mock State
    if (type === 'dice') {
        mockUser.diceBalance.available += amount;
        if (currency === Currency.STARS) {
            mockUser.diceBalance.starsAttempts += amount;
        }
    } else if (type === 'nft') {
        mockUser.nftBalance.total += amount;
        if (currency === Currency.STARS) {
             mockUser.nftBalance.locked += amount;
             mockUser.nftBalance.lockedDetails.push({ 
                 amount, 
                 unlockDate: Date.now() + (21 * 86400000) 
             });
        } else {
             mockUser.nftBalance.available += amount;
        }
    }
    return true;
  }
};

export const rollDice = async (): Promise<number> => {
  try {
    const data = await apiRequest('/roll', 'POST');
    return data.roll;
  } catch (error) {
    console.warn("Backend unreachable. Simulating Dice Roll.", error);
    
    if (mockUser.diceBalance.available <= 0) {
        throw new Error("No attempts left");
    }

    const roll = Math.floor(Math.random() * 6) + 1;
    
    // Update Mock State
    mockUser.diceBalance.available -= 1;
    mockUser.diceBalance.used += 1;
    mockUser.nftBalance.total += roll;
    mockUser.nftBalance.available += roll;
    
    return roll;
  }
};

export const withdrawNFT = async (): Promise<void> => {
  throw new Error("Address required for withdrawal"); 
};

export const withdrawNFTWithAddress = async (address: string): Promise<void> => {
    try {
      await apiRequest('/withdraw', 'POST', { address });
    } catch (error) {
      console.warn("Backend unreachable. Simulating Withdrawal.", error);
      mockUser.walletAddress = address;
      mockUser.nftBalance.total -= mockUser.nftBalance.available;
      mockUser.nftBalance.available = 0;
    }
};
