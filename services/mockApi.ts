import { UserProfile, Currency, NftTransaction } from '../types';

// In production (Docker), Nginx proxies /api to the backend.
// We use a relative path so it works regardless of the domain.
const API_URL = '/api'; 

// Utility for delay to simulate network
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

// Mock History Data
const mockHistory: NftTransaction[] = [
    { id: '1', type: 'win', assetType: 'nft', amount: 6, timestamp: Date.now() - 1000 * 60 * 5, description: 'Dice Roll: Jackpot', isLocked: false },
    { id: '2', type: 'purchase', assetType: 'nft', amount: 5, timestamp: Date.now() - 1000 * 60 * 60 * 2, description: 'Genesis Pack (x5)', currency: Currency.TON, isLocked: false },
    { id: '3', type: 'purchase', assetType: 'dice', amount: 10, timestamp: Date.now() - 1000 * 60 * 60 * 5, description: 'Dice Attempts (x10)', currency: Currency.STARS },
    { id: '4', type: 'win', assetType: 'nft', amount: 4, timestamp: Date.now() - 1000 * 60 * 60 * 24, description: 'Dice Roll: Rare', isLocked: true }, // Simulating a locked win
    { id: '5', type: 'referral', assetType: 'currency', amount: 2, timestamp: Date.now() - 1000 * 60 * 60 * 48, description: 'Referral Bonus (Lvl 1)' },
    { id: '6', type: 'purchase', assetType: 'nft', amount: 10, timestamp: Date.now() - 1000 * 60 * 60 * 24 * 3, description: 'Starter Pack', currency: Currency.STARS, isLocked: true },
    { id: '7', type: 'win', assetType: 'nft', amount: 1, timestamp: Date.now() - 1000 * 60 * 60 * 24 * 5, description: 'Dice Roll: Basic', isLocked: false },
];

// Helper to get the Telegram User ID securely
const getTelegramUserId = (): number => {
  // Fallback for local browser testing without Telegram context
  if (!window.Telegram?.WebApp?.initDataUnsafe?.user) {
    return 123456789; 
  }
  return window.Telegram.WebApp.initDataUnsafe.user.id;
};

// Helper for authorized fetch requests with HARD Timeout
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

  try {
    // RACE CONDITION: Force a timeout even if fetch hangs (e.g. pending DNS or Proxy)
    const timeoutPromise = new Promise<Response>((_, reject) => 
        setTimeout(() => reject(new Error("Network timeout")), 1500)
    );

    const fetchPromise = fetch(url, config);

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
    }

    // CRITICAL: Check if response is actually JSON. 
    // Vite preview often returns index.html (text/html) for unknown routes (404s handled by SPA).
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Invalid response format (received HTML instead of JSON)");
    }

    return await response.json();
  } catch (error) {
    // This catch block ensures we propagate the error so the caller (rollDice) 
    // can switch to the Mock Fallback immediately.
    throw error;
  }
};

export const fetchUserProfile = async (): Promise<UserProfile> => {
  try {
    return await apiRequest('/user');
  } catch (error) {
    console.warn("Backend unavailable. Switching to Mock Mode.");
    // Simulate a short delay so it doesn't feel instant/broken
    await delay(300); 
    return JSON.parse(JSON.stringify(mockUser));
  }
};

export const fetchNftHistory = async (): Promise<NftTransaction[]> => {
    try {
        // Implement backend endpoint /api/history later
        // return await apiRequest('/history');
        throw new Error("Not implemented");
    } catch (error) {
        await delay(400);
        // Return sorted mock history
        return [...mockHistory].sort((a,b) => b.timestamp - a.timestamp);
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
    console.warn("Backend unavailable. Simulating Purchase.");
    await delay(500); 
    
    // Update Mock State
    if (type === 'dice') {
        mockUser.diceBalance.available += amount;
        if (currency === Currency.STARS) {
            mockUser.diceBalance.starsAttempts += amount;
        }
        
        // Add Dice purchase to history
        mockHistory.push({
            id: Date.now().toString(),
            type: 'purchase',
            assetType: 'dice',
            amount,
            timestamp: Date.now(),
            description: `Dice Attempts (x${amount})`,
            currency: currency
        });

    } else if (type === 'nft') {
        mockUser.nftBalance.total += amount;
        const isStars = currency === Currency.STARS;

        if (isStars) {
             mockUser.nftBalance.locked += amount;
             mockUser.nftBalance.lockedDetails.push({ 
                 amount, 
                 unlockDate: Date.now() + (21 * 86400000) 
             });
        } else {
             mockUser.nftBalance.available += amount;
        }
        
        // Add NFT purchase to history
        mockHistory.push({
            id: Date.now().toString(),
            type: 'purchase',
            assetType: 'nft',
            amount,
            timestamp: Date.now(),
            description: `Pack Purchase`,
            currency: currency,
            isLocked: isStars
        });
    }
    return true;
  }
};

export const rollDice = async (): Promise<number> => {
  try {
    const data = await apiRequest('/roll', 'POST');
    return data.roll;
  } catch (error) {
    console.warn("Backend unavailable. Simulating Dice Roll.");
    
    // Check local mock balance immediately
    if (mockUser.diceBalance.available <= 0) {
        throw new Error("No attempts left");
    }

    // Return mock roll
    const roll = Math.floor(Math.random() * 6) + 1;
    
    // Logic: If user has 'Stars Attempts', use them first and LOCK the reward.
    const isStarAttempt = mockUser.diceBalance.starsAttempts > 0;

    // Update Mock State
    mockUser.diceBalance.available -= 1;
    mockUser.diceBalance.used += 1;
    
    if (isStarAttempt) {
        mockUser.diceBalance.starsAttempts -= 1;
        mockUser.nftBalance.locked += roll;
        mockUser.nftBalance.lockedDetails.push({
            amount: roll,
            unlockDate: Date.now() + (21 * 86400000)
        });
    } else {
        mockUser.nftBalance.available += roll;
    }
    
    mockUser.nftBalance.total += roll;
    
    // Add to history
    mockHistory.push({
        id: Date.now().toString(),
        type: 'win',
        assetType: 'nft',
        amount: roll,
        timestamp: Date.now(),
        description: roll >= 4 ? `Dice Win: Big Roll` : `Dice Win`,
        isLocked: isStarAttempt
    });
    
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
      console.warn("Backend unavailable. Simulating Withdrawal.");
      await delay(800);
      
      // History
      mockHistory.push({
          id: Date.now().toString(),
          type: 'withdraw',
          assetType: 'nft',
          amount: mockUser.nftBalance.available,
          timestamp: Date.now(),
          description: `Withdraw to ${address.slice(0,4)}...`
      });

      mockUser.walletAddress = address;
      mockUser.nftBalance.total -= mockUser.nftBalance.available;
      mockUser.nftBalance.available = 0;
    }
};