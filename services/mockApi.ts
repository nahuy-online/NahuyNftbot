import { UserProfile, Currency, NftTransaction, PaymentInitResponse } from '../types';

// In production (Docker), Nginx proxies /api to the backend.
const API_URL = '/api'; 

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- MOCK STATE ---
let mockUser: UserProfile = {
  id: 123456789,
  username: "DemoUser",
  nftBalance: {
    total: 10,
    available: 5,
    locked: 5,
    lockedDetails: [
        { amount: 5, unlockDate: Date.now() + 86400000 * 21 }
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

const mockHistory: NftTransaction[] = [
    { id: '1', type: 'win', assetType: 'nft', amount: 6, timestamp: Date.now() - 1000 * 60 * 5, description: 'Dice Roll: Jackpot', isLocked: false },
    { id: '2', type: 'purchase', assetType: 'nft', amount: 5, timestamp: Date.now() - 1000 * 60 * 60 * 2, description: 'Genesis Pack (x5)', currency: Currency.TON, isLocked: false },
];

const getTelegramUserId = (): number => {
  if (!window.Telegram?.WebApp?.initDataUnsafe?.user) {
    return 123456789; 
  }
  return window.Telegram.WebApp.initDataUnsafe.user.id;
};

const apiRequest = async (endpoint: string, method: string = 'GET', body?: any) => {
  const userId = getTelegramUserId();
  const headers: HeadersInit = { 'Content-Type': 'application/json', 'X-Telegram-User-Id': userId.toString() };
  const config: RequestInit = { method, headers, body: body ? JSON.stringify({ id: userId, ...body }) : undefined };
  let url = `${API_URL}${endpoint}`;
  if (method === 'GET') url += `?id=${userId}`;

  try {
    const timeoutPromise = new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("Network timeout")), 1500));
    const fetchPromise = fetch(url, config);
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) throw new Error("Invalid response format");
    return await response.json();
  } catch (error) {
    throw error;
  }
};

export const fetchUserProfile = async (): Promise<UserProfile> => {
  try {
    return await apiRequest('/user');
  } catch (error) {
    console.warn("Backend unavailable. Switching to Mock Mode.");
    await delay(300); 
    return JSON.parse(JSON.stringify(mockUser));
  }
};

export const fetchNftHistory = async (): Promise<NftTransaction[]> => {
    try {
        throw new Error("Not implemented");
    } catch (error) {
        await delay(400);
        return [...mockHistory].sort((a,b) => b.timestamp - a.timestamp);
    }
};

// --- PAYMENT LOGIC ---

// 1. Initiate Payment (Get Invoice Link or Transaction Params)
export const createPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency): Promise<PaymentInitResponse> => {
    try {
        return await apiRequest('/payment/create', 'POST', { type, amount, currency });
    } catch (e) {
        console.warn("Backend unavailable. Creating Mock Payment.");
        await delay(500);

        if (currency === Currency.STARS) {
            // Mock Telegram Stars Invoice Link
            // In real app, backend generates this via Bot API
            return {
                ok: true,
                currency: Currency.STARS,
                invoiceLink: "https://t.me/$" // This won't work in reality without a real link
            };
        } else {
            // Mock TON Transaction for TonConnect
            // 1 TON = 1e9 nanotons
            const price = type === 'nft' ? 1 : 0.5; // Mock price logic
            const nanoAmount = (price * 1000000000).toString();
            
            return {
                ok: true,
                currency: Currency.TON,
                transaction: {
                    validUntil: Math.floor(Date.now() / 1000) + 600, // 10 min
                    messages: [
                        {
                            address: "0QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC", // Burn address as mock
                            amount: nanoAmount,
                            // Payload would be base64 BOC for comments/opcodes
                        }
                    ]
                }
            };
        }
    }
};

// 2. Verify Payment (Call after frontend confirms action)
export const verifyPayment = async (type: 'nft' | 'dice', amount: number, currency: Currency, paymentProof?: string): Promise<boolean> => {
    try {
        await apiRequest('/payment/verify', 'POST', { type, amount, currency, proof: paymentProof });
        return true;
    } catch (e) {
        console.warn("Backend unavailable. Simulating Verification Success.");
        await delay(1000); // Simulate blockchain wait time
        
        // Update Mock State locally to show instant feedback
        if (type === 'dice') {
            mockUser.diceBalance.available += amount;
            if (currency === Currency.STARS) mockUser.diceBalance.starsAttempts += amount;
        } else {
            mockUser.nftBalance.total += amount;
            const isStars = currency === Currency.STARS;
            if (isStars) {
                mockUser.nftBalance.locked += amount;
                mockUser.nftBalance.lockedDetails.push({ amount, unlockDate: Date.now() + (21 * 86400000) });
            } else {
                mockUser.nftBalance.available += amount;
            }
        }
        
        mockHistory.push({
            id: Date.now().toString(),
            type: 'purchase',
            assetType: type,
            amount,
            timestamp: Date.now(),
            description: `${type === 'dice' ? 'Dice Attempts' : 'NFT Pack'} (x${amount})`,
            currency: currency,
            isLocked: currency === Currency.STARS && type === 'nft'
        });

        return true;
    }
};

// Deprecated direct purchase (kept for compatibility if needed, but redirects logic)
export const purchaseItem = async (type: 'nft' | 'dice', amount: number, currency: Currency): Promise<boolean> => {
    console.warn("Using deprecated purchaseItem. Please use createPayment flow.");
    return verifyPayment(type, amount, currency);
};

export const rollDice = async (): Promise<number> => {
  try {
    const data = await apiRequest('/roll', 'POST');
    return data.roll;
  } catch (error) {
    console.warn("Backend unavailable. Simulating Dice Roll.");
    if (mockUser.diceBalance.available <= 0) throw new Error("No attempts left");

    const roll = Math.floor(Math.random() * 6) + 1;
    const isStarAttempt = mockUser.diceBalance.starsAttempts > 0;

    mockUser.diceBalance.available -= 1;
    mockUser.diceBalance.used += 1;
    if (isStarAttempt) {
        mockUser.diceBalance.starsAttempts -= 1;
        mockUser.nftBalance.locked += roll;
        mockUser.nftBalance.lockedDetails.push({ amount: roll, unlockDate: Date.now() + (21 * 86400000) });
    } else {
        mockUser.nftBalance.available += roll;
    }
    
    mockUser.nftBalance.total += roll;
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

export const withdrawNFTWithAddress = async (address: string): Promise<void> => {
    try {
      await apiRequest('/withdraw', 'POST', { address });
    } catch (error) {
      console.warn("Backend unavailable. Simulating Withdrawal.");
      await delay(800);
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
