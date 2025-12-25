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

export interface UserProfile {
  id: number;
  username: string;
  nftBalance: {
    total: number;
    available: number;
    locked: number; // For Stars hold 21 days
  };
  diceBalance: {
    available: number;
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