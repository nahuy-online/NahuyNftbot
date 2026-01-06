
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
  serials?: number[]; // Specific NFT IDs involved in this lock batch
  isSeized?: boolean; // If true, these assets were revoked (e.g. refund)
}

export type TransactionType = 'purchase' | 'win' | 'referral' | 'withdraw' | 'referral_reward' | 'seizure';

export interface NftTransaction {
  id: string;
  type: TransactionType;
  assetType: 'nft' | 'dice' | 'currency'; // What kind of asset changed
  amount: number;
  timestamp: number;
  description: string;
  currency?: Currency; // Currency used for payment (if purchase)
  isLocked?: boolean; // If the resulting NFT is locked (requires *)
  serials?: number[]; // Specific NFT IDs involved in this transaction
}

export interface UserProfile {
  id: number;
  username: string;
  isNewUser?: boolean; // Trigger for Onboarding Screen
  referralCode?: string; // New Privacy-focused referral code
  referrerId?: number | null; // ID of the person who invited this user
  referralDebug?: string; // Debug info from backend about linking process
  nftBalance: {
    total: number;
    available: number;
    locked: number; // Summary count
    lockedDetails: LockedNftItem[]; // Specific items with dates
  };
  reservedSerials?: number[]; // IDs of the NFTs user owns (e.g. 101, 102)
  diceBalance: {
    available: number; // Total available
    starsAttempts: number; // Subset of available that was bought with Stars
    used: number;
  };
  referralStats: {
    level1: number;
    level2: number;
    level3: number;
    bonusBalance: { // Renamed from earnings
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
