import { UserProfile, Currency } from '../types';

// Mock initial state
let mockUser: UserProfile = {
  id: 123456789,
  username: "crypto_enthusiast",
  nftBalance: {
    total: 2,
    available: 1,
    locked: 1,
    lockedDetails: [
        {
            amount: 1,
            unlockDate: Date.now() + (15 * 24 * 60 * 60 * 1000) // One pre-locked for testing (15 days left)
        }
    ]
  },
  diceBalance: {
    available: 5,
    starsAttempts: 2, // 2 of the 5 attempts will result in locked winnings
    used: 12
  },
  referralStats: {
    level1: 10,
    level2: 5,
    level3: 2,
    earnings: {
      STARS: 500,
      TON: 2.5,
      USDT: 10
    }
  },
  walletAddress: undefined
};

const LOCK_PERIOD_MS = 21 * 24 * 60 * 60 * 1000; // 21 Days

export const fetchUserProfile = async (): Promise<UserProfile> => {
  return new Promise((resolve) => {
    // Clean up expired locks on fetch
    const now = Date.now();
    const activeLocks = [];
    let unlockedAmount = 0;

    for (const item of mockUser.nftBalance.lockedDetails) {
        if (now >= item.unlockDate) {
            unlockedAmount += item.amount;
        } else {
            activeLocks.push(item);
        }
    }

    if (unlockedAmount > 0) {
        mockUser.nftBalance.locked -= unlockedAmount;
        mockUser.nftBalance.available += unlockedAmount;
        mockUser.nftBalance.lockedDetails = activeLocks;
    }

    setTimeout(() => resolve({ ...mockUser }), 500);
  });
};

export const connectWallet = async (): Promise<string> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const addr = "UQDa...MockWalletAddress";
      mockUser.walletAddress = addr;
      resolve(addr);
    }, 1000);
  });
};

export const purchaseItem = async (type: 'nft' | 'dice', amount: number, currency: Currency): Promise<boolean> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (type === 'nft') {
        mockUser.nftBalance.total += amount;
        if (currency === Currency.STARS) {
            mockUser.nftBalance.locked += amount;
            mockUser.nftBalance.lockedDetails.push({
                amount: amount,
                unlockDate: Date.now() + LOCK_PERIOD_MS
            });
        } else {
            mockUser.nftBalance.available += amount;
        }
      } else {
        // Dice purchase
        mockUser.diceBalance.available += amount;
        if (currency === Currency.STARS) {
            mockUser.diceBalance.starsAttempts += amount;
        }
      }
      resolve(true);
    }, 1500);
  });
};

export const rollDice = async (): Promise<number> => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (mockUser.diceBalance.available > 0) {
                mockUser.diceBalance.available -= 1;
                mockUser.diceBalance.used += 1;
                
                // Determine if this was a "Star Attempt"
                // We prioritize using Star attempts (locking logic) or Common attempts.
                // For this implementation, we consume Star attempts first.
                const isStarAttempt = mockUser.diceBalance.starsAttempts > 0;
                if (isStarAttempt) {
                    mockUser.diceBalance.starsAttempts -= 1;
                }

                const result = Math.floor(Math.random() * 6) + 1;
                
                mockUser.nftBalance.total += result;

                if (isStarAttempt) {
                    // Logic: Winnings from Stars attempts are LOCKED for 21 days
                    mockUser.nftBalance.locked += result;
                    mockUser.nftBalance.lockedDetails.push({
                        amount: result,
                        unlockDate: Date.now() + LOCK_PERIOD_MS
                    });
                } else {
                    // Winnings from TON/USDT attempts are liquid
                    mockUser.nftBalance.available += result;
                }

                resolve(result);
            } else {
                reject("No attempts left");
            }
        }, 1000);
    });
};

export const withdrawNFT = async (): Promise<void> => {
    return new Promise((resolve) => {
        setTimeout(() => {
            // Lazy mint logic simulation
            if (mockUser.nftBalance.available > 0) {
                 mockUser.nftBalance.available = 0;
            }
            resolve();
        }, 2000);
    });
}