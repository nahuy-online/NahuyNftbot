import React, { useState } from 'react';
import { Currency } from '../types';
import { NFT_PRICES, PACK_SIZES } from '../constants';
import { purchaseItem } from '../services/mockApi';

interface ShopProps {
  onPurchaseComplete: () => void;
}

export const Shop: React.FC<ShopProps> = ({ onPurchaseComplete }) => {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(Currency.STARS);
  const [selectedPack, setSelectedPack] = useState<number>(1);
  const [loading, setLoading] = useState(false);

  const handleBuy = async () => {
    setLoading(true);
    try {
      // Here we would integrate with Telegram Payments (Stars) or TonConnect (TON/USDT)
      await purchaseItem('nft', selectedPack, selectedCurrency);
      alert(`Successfully purchased ${selectedPack} NFT(s)!`);
      onPurchaseComplete();
    } catch (e) {
      alert("Purchase failed");
    } finally {
      setLoading(false);
    }
  };

  const pricePerUnit = NFT_PRICES[selectedCurrency];
  const totalPrice = (pricePerUnit * selectedPack).toFixed(selectedCurrency === Currency.STARS ? 0 : 2);

  return (
    <div className="p-4 space-y-6 pb-24">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
          Genesis Collection
        </h2>
        <p className="text-gray-400 text-sm mt-1">Buy NFTs to hold or trade.</p>
      </div>

      {/* Image Placeholder */}
      <div className="aspect-square rounded-xl overflow-hidden shadow-lg border border-gray-700 bg-gray-800 flex items-center justify-center relative group">
        <img 
            src="https://picsum.photos/400/400?random=1" 
            alt="NFT Preview" 
            className="object-cover w-full h-full opacity-80 group-hover:opacity-100 transition-opacity"
        />
        <div className="absolute bottom-2 right-2 bg-black/60 px-2 py-1 rounded text-xs">
           Lazy Mint
        </div>
      </div>

      {/* Currency Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-400">Select Currency</label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.values(Currency) as Currency[]).map((curr) => (
            <button
              key={curr}
              onClick={() => setSelectedCurrency(curr)}
              className={`py-2 rounded-lg text-sm font-bold border transition-all ${
                selectedCurrency === curr
                  ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {curr}
            </button>
          ))}
        </div>
        {selectedCurrency === Currency.STARS && (
            <p className="text-xs text-yellow-500 mt-1">
                ⚠️ 21-day hold applies to NFTs bought with Stars.
            </p>
        )}
      </div>

      {/* Pack Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-400">Select Quantity</label>
        <div className="flex justify-between gap-2">
          {PACK_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setSelectedPack(size)}
              className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-all ${
                selectedPack === size
                  ? 'bg-purple-600 border-purple-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Summary & Action */}
      <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
        <div className="flex justify-between items-center mb-4">
          <span className="text-gray-300">Total Price</span>
          <span className="text-xl font-mono font-bold text-white">
            {totalPrice} <span className="text-sm text-gray-400">{selectedCurrency}</span>
          </span>
        </div>
        <button
          onClick={handleBuy}
          disabled={loading}
          className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-transform active:scale-95 ${
            loading 
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white'
          }`}
        >
          {loading ? 'Processing...' : `Buy ${selectedPack} NFT${selectedPack > 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
};