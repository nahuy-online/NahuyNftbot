
import { PriceConfig } from './types';

// Replace with your actual bot username without @
export const BOT_USERNAME = 'nahuy_NFT_bot'; 
export const GETGEMS_URL = 'https://getgems.io/';

// Prices per 1 Item (NFT or Attempt)
export const NFT_PRICES: PriceConfig = {
  STARS: 2000,
  TON: 0.011,
  USDT: 36.6
};

// Based on TZ Section 3.3
export const DICE_ATTEMPT_PRICES: PriceConfig = {
  STARS: 6666,
  TON: 0.0366,
  USDT: 121
};

export const PACK_SIZES = [1, 3, 5, 7];

export const MAX_NFT_PER_DAY = 42;
export const MAX_DICE_PER_DAY = 21;
