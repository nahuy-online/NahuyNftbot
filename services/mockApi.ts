import { UserProfile, Currency } from '../types';

// Mock initial state
let mockUser: UserProfile = {
  id: 123456789,
  username: "crypto_enthusiast",
  nftBalance: {
    total: 2,
    available: 1,
    locked: 1
  },
  diceBalance: {
    available: 5,
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

export const fetchUserProfile = async (): Promise<UserProfile> => {
  return new Promise((resolve) => {
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
      // Simulate successful purchase logic
      if (type === 'nft') {
        mockUser.nftBalance.total += amount;
        if (currency === Currency.STARS) {
            mockUser.nftBalance.locked += amount;
        } else {
            mockUser.nftBalance.available += amount;
        }
      } else {
        mockUser.diceBalance.available += amount;
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
                const result = Math.floor(Math.random() * 6) + 1;
                // TZ Rule: Result number = Amount of NFTs won
                mockUser.nftBalance.total += result;
                mockUser.nftBalance.available += result; // Dice winnings are usually available immediately unless bought with locked stars
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