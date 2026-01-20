
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
  isAdmin?: boolean; // NEW: Admin flag
  isNewUser?: boolean; // Trigger for Onboarding Screen
  referralCode?: string; // New Privacy-focused referral code
  referrerId?: number | null; // ID of the person who invited this user
  referralDebug?: string; // Debug info from backend about linking process
  ip?: string; // NEW: User IP
  joinedAt?: number; // NEW: Registration timestamp
  lastActive?: number; // NEW: Last action timestamp
  nftBalance: {
    total: number;
    available: number;
    locked: number; // Summary count
    lockedDetails: LockedNftItem[]; // Specific items with dates
    withdrawn: number; // Total withdrawn count
  };
  reservedSerials?: number[]; // IDs of the NFTs user currently owns
  withdrawnSerials?: number[]; // IDs of the NFTs user has withdrawn
  diceBalance: {
    available: number; // Total available
    starsAttempts: number; // Subset of available that was bought with Stars
    used: number;
  };
  referralStats: {
    level1: number;
    level2: number;
    level3: number;
    lockedStars: number; // NEW: Track locked bonus stars
    bonusBalance: { // Renamed from earnings
      [key in Currency]: number; // Represents AVAILABLE balance
    };
  };
  walletAddress?: string;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number; // Users who made a purchase
  totalNftSold: number;
  totalDicePlays: number; // Number of games played
  totalNftWonInDice: number; // Total quantity of NFTs won
  revenue: {
    TON: number;
    STARS: number;
    USDT: number;
  };
  bonusStats: {
    earned: { TON: number; STARS: number; USDT: number };
    spent: { TON: number; STARS: number; USDT: number };
  };
  recentTransactions: NftTransaction[];
}

export type UserSortField = 'joined_at' | 'last_active' | 'nft_total' | 'referrals';

export type Tab = 'shop' | 'dice' | 'profile' | 'admin';

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
