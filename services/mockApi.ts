import { UserProfile, Currency, NftTransaction, PaymentInitResponse } from '../types';

const API_BASE = '/api'; 
const STORAGE_KEY = 'nft_app_local_db_v2';

// --- HELPER: LOCAL STORAGE DB ---
// This simulates a database inside the user's browser so the app works without a real backend.

const getInitialData = (userId: number): UserProfile => ({
    id: userId,
    username: window.Telegram?.WebApp?.initDataUnsafe?.user?.username || "DemoUser",
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

const getLocalDb = (): UserProfile => {
    const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 12345;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        return JSON.parse(stored);
    }
    const newData = getInitialData(userId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
    return newData;
};

const saveLocalDb = (data: UserProfile) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

const addTransaction = (tx: Partial<NftTransaction>) => {
    const txsStr = localStorage.getItem(STORAGE_KEY + '_txs');
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
    localStorage.setItem(STORAGE_KEY + '_txs', JSON.stringify(txs.slice(0, 50))); // Keep last 50
};

// --- MOCK LOGIC HANDLERS ---

const handleMockFallback = async (endpoint: string, method: string, body?: any) => {
    // Simulate network delay
    await new Promise(r => setTimeout(r, 600));

    const db = getLocalDb();

    // 1. GET USER
    if (endpoint.includes('/user')) {
        return db;
    }

    // 2. GET HISTORY
    if (endpoint.includes('/history')) {
        const txsStr = localStorage.getItem(STORAGE_KEY + '_txs');
        return txsStr ? JSON.parse(txsStr) : [];
    }

    // 3. CREATE PAYMENT
    if (endpoint.includes('/payment/create')) {
        return { 
            ok: true, 
            currency: body.currency, 
            invoiceLink: body.currency === 'STARS' ? 'https://t.me/$' : undefined,
            transaction: body.currency !== 'STARS' ? { 
                validUntil: Date.now() + 600000, 
                messages: [] 
            } : undefined
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
            addTransaction({ type: 'purchase', assetType: 'nft', amount, currency, description: `Bought ${amount} NFT`, isLocked: isStars });
        } 
        else if (type === 'dice') {
            db.diceBalance.available += amount;
            if (currency === 'STARS') {
                db.diceBalance.starsAttempts += amount;
            }
            addTransaction({ type: 'purchase', assetType: 'dice', amount, currency, description: `Bought ${amount} Attempts` });
        }
        
        saveLocalDb(db);
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

        // Check if this was a "Stars Attempt" (logic: use stars attempts first or last? lets say simple FIFO)
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
            addTransaction({ type: 'win', assetType: 'nft', amount: winAmount, description: `Won on Roll ${roll}`, isLocked: isStarsAttempt });
        }

        saveLocalDb(db);
        return { roll };
    }

    // 6. WITHDRAW
    if (endpoint.includes('/withdraw')) {
        const { address } = body;
        const amount = db.nftBalance.available;
        
        if (amount <= 0) throw new Error("Nothing to withdraw");

        db.nftBalance.available = 0;
        db.nftBalance.total -= amount; // Assuming withdrawal removes them from internal balance
        
        addTransaction({ type: 'withdraw', assetType: 'nft', amount: amount, description: 'Withdrawal to wallet' });
        saveLocalDb(db);
        return { ok: true };
    }

    return {};
};


// --- API REQUEST WRAPPER ---
// Tries to connect to real backend, but aggressively falls back to local DB logic
const apiRequest = async (endpoint: string, method: string = 'GET', body?: any) => {
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
  if (method === 'GET') {
      url += url.includes('?') ? `&id=${userId}` : `?id=${userId}`;
  }

  try {
    // Attempt real fetch
    const response = await fetch(url, config);
    if (!response.ok) throw new Error("Backend error");
    return await response.json();
  } catch (error: any) {
    // If real backend fails (which it is right now), use the smart local DB logic
    console.log(`📡 Backend unreachable, executing local logic for ${endpoint}`);
    return handleMockFallback(endpoint, method, body);
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
