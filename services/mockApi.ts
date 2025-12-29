import { UserProfile, Currency, NftTransaction, PaymentInitResponse } from '../types';

const API_BASE = '/api'; 
const BASE_STORAGE_KEY = 'nft_app_db_v3';

// --- HELPER: LOCAL STORAGE DB (Now User Specific) ---

const getUserId = (): number => {
    return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 12345;
};

const getStorageKey = (userId: number) => `${BASE_STORAGE_KEY}_${userId}`;

const getInitialData = (userId: number): UserProfile => ({
    id: userId,
    username: window.Telegram?.WebApp?.initDataUnsafe?.user?.username || `User_${userId}`,
    nftBalance: { 
        total: 0, 
        available: 0, 
        locked: 0, 
        lockedDetails: [] 
    },
    diceBalance: { 
        available: 5, // Give 5 free attempts at start
        starsAttempts: 0, 
        used: 0 
    },
    referralStats: { 
        level1: 0, level2: 0, level3: 0, 
        earnings: { STARS: 0, TON: 0, USDT: 0 } 
    },
    walletAddress: undefined
});

const getLocalDb = (userId: number): UserProfile => {
    const key = getStorageKey(userId);
    const stored = localStorage.getItem(key);
    if (stored) {
        return JSON.parse(stored);
    }
    const newData = getInitialData(userId);
    localStorage.setItem(key, JSON.stringify(newData));
    return newData;
};

const saveLocalDb = (userId: number, data: UserProfile) => {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(data));
};

const addTransaction = (userId: number, tx: Partial<NftTransaction>) => {
    const key = getStorageKey(userId) + '_txs';
    const txsStr = localStorage.getItem(key);
    const txs: NftTransaction[] = txsStr ? JSON.parse(txsStr) : [];
    
    const newTx: NftTransaction = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'purchase',
        assetType: 'currency',
        amount: 0,
        timestamp: Date.now(),
        description: 'Transaction',
        ...tx
    };
    
    txs.unshift(newTx);
    localStorage.setItem(key, JSON.stringify(txs.slice(0, 50))); // Keep last 50
};

// --- MOCK LOGIC HANDLERS ---

const handleMockFallback = async (endpoint: string, method: string, body?: any) => {
    // Simulate network delay
    await new Promise(r => setTimeout(r, 600));

    // CRITICAL: Always use the ID from the request or current context to separate users
    const userId = body?.id || getUserId();
    const db = getLocalDb(userId);

    // 1. GET USER
    if (endpoint.includes('/user')) {
        return db;
    }

    // 2. GET HISTORY
    if (endpoint.includes('/history')) {
        const key = getStorageKey(userId) + '_txs';
        const txsStr = localStorage.getItem(key);
        return txsStr ? JSON.parse(txsStr) : [];
    }

    // 3. CREATE PAYMENT
    if (endpoint.includes('/payment/create')) {
        const isStars = body.currency === 'STARS';
        
        // Fix for TON Error: providing a valid dummy transaction structure
        // This simulates a transfer of 0.05 TON to a burn address
        const tonTransaction = {
            validUntil: Math.floor(Date.now() / 1000) + 600, // 10 min
            messages: [
                {
                    address: "0QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC", // Null/Burn address for test
                    amount: "50000000", // 0.05 TON in nanotons
                    payload: "" // Optional comment
                }
            ]
        };

        return { 
            ok: true, 
            currency: body.currency, 
            invoiceLink: isStars ? 'https://t.me/$' : undefined,
            transaction: !isStars ? tonTransaction : undefined
        };
    }

    // 4. VERIFY PAYMENT (Purchase Logic)
    if (endpoint.includes('/payment/verify')) {
        const { type, amount, currency } = body;
        
        if (type === 'nft') {
            const isStars = currency === 'STARS';
            db.nftBalance.total += amount;
            if (isStars) {
                db.nftBalance.locked += amount;
                db.nftBalance.lockedDetails.push({
                    amount: amount,
                    unlockDate: Date.now() + (21 * 24 * 60 * 60 * 1000)
                });
            } else {
                db.nftBalance.available += amount;
            }
            addTransaction(userId, { type: 'purchase', assetType: 'nft', amount, currency, description: `Bought ${amount} NFT`, isLocked: isStars });
        } 
        else if (type === 'dice') {
            db.diceBalance.available += amount;
            if (currency === 'STARS') {
                db.diceBalance.starsAttempts += amount;
            }
            addTransaction(userId, { type: 'purchase', assetType: 'dice', amount, currency, description: `Bought ${amount} Attempts` });
        }
        
        saveLocalDb(userId, db);
        return true;
    }

    // 5. ROLL DICE (Game Logic)
    if (endpoint.includes('/roll')) {
        if (db.diceBalance.available <= 0) {
            throw new Error("No attempts left");
        }

        const roll = Math.floor(Math.random() * 6) + 1; // 1-6
        
        db.diceBalance.available -= 1;
        db.diceBalance.used += 1;

        // Check if this was a "Stars Attempt"
        let isStarsAttempt = false;
        if (db.diceBalance.starsAttempts > 0) {
            db.diceBalance.starsAttempts -= 1;
            isStarsAttempt = true;
        }

        // Winning Logic
        let winAmount = 0;
        if (roll === 6) winAmount = 5; // Jackpot
        else if (roll === 5) winAmount = 3;
        else if (roll === 4) winAmount = 1;

        if (winAmount > 0) {
            db.nftBalance.total += winAmount;
            if (isStarsAttempt) {
                db.nftBalance.locked += winAmount;
                db.nftBalance.lockedDetails.push({
                    amount: winAmount,
                    unlockDate: Date.now() + (21 * 24 * 60 * 60 * 1000)
                });
            } else {
                db.nftBalance.available += winAmount;
            }
            addTransaction(userId, { type: 'win', assetType: 'nft', amount: winAmount, description: `Won on Roll ${roll}`, isLocked: isStarsAttempt });
        }

        saveLocalDb(userId, db);
        return { roll };
    }

    // 6. WITHDRAW
    if (endpoint.includes('/withdraw')) {
        const { address } = body;
        const amount = db.nftBalance.available;
        
        if (amount <= 0) throw new Error("Nothing to withdraw");

        db.nftBalance.available = 0;
        db.nftBalance.total -= amount; 
        
        addTransaction(userId, { type: 'withdraw', assetType: 'nft', amount: amount, description: 'Withdrawal to wallet' });
        saveLocalDb(userId, db);
        return { ok: true };
    }

    return {};
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
    // Attempt real fetch first
    const response = await fetch(url, config);
    if (!response.ok) throw new Error("Backend error");
    return await response.json();
  } catch (error: any) {
    console.log(`📡 Using local logic for ${endpoint} (User: ${userId})`);
    // Explicitly pass userId logic inside fallback
    return handleMockFallback(endpoint, method, { id: userId, ...body });
  }
};

// --- EXPORTS ---

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
    return await apiRequest('/payment/verify', 'POST', { type, amount, currency });
};

export const rollDice = async (): Promise<number> => {
    const data = await apiRequest('/roll', 'POST');
    return data.roll;
};

export const withdrawNFTWithAddress = async (address: string): Promise<void> => {
    await apiRequest('/withdraw', 'POST', { address });
};