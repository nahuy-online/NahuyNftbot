export enum Currency {
  TON = 'TON',
  USDT = 'USDT',
  STARS = 'STARS'
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

export type TransactionType = 'purchase' | 'win' | 'referral' | 'withdraw';

export interface NftTransaction {
  id: string;
  type: TransactionType;
  assetType: 'nft' | 'dice' | 'currency'; // What kind of asset changed
  amount: number;
  timestamp: number;
  description: string;
  currency?: Currency; // Currency used for payment (if purchase)
  isLocked?: boolean; // If the resulting NFT is locked (requires *)
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

// --- PAYMENT TYPES ---

export interface PaymentInitResponse {
  ok: boolean;
  currency: Currency;
  // For Stars
  invoiceLink?: string; 
  // For TON/TonConnect
  transaction?: {
    validUntil: number;
    messages: {
      address: string;
      amount: string; // nanotons
      payload?: string; // base64 boc for comments/jettons
    }[];
  };
}
