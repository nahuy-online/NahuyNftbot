export enum Currency {
  STARS = 'STARS',
  TON = 'TON',
  USDT = 'USDT'
}

export interface PriceConfig {
  [Currency.STARS]: number;
  [Currency.TON]: number;
  [Currency.USDT]: number;
}

export interface LockedNftItem {
  amount: number;
  unlockDate: number; // Timestamp
}

export interface UserProfile {
  id: number;
  username: string;
  nftBalance: {
    total: number;
    available: number;
    locked: number; // Summary count
    lockedDetails: LockedNftItem[]; // Specific items with dates
  };
  diceBalance: {
    available: number; // Total available
    starsAttempts: number; // Subset of available that was bought with Stars
    used: number;
  };
  referralStats: {
    level1: number;
    level2: number;
    level3: number;
    earnings: {
      [key in Currency]: number;
    };
  };
  walletAddress?: string;
}

export type Tab = 'shop' | 'dice' | 'profile';