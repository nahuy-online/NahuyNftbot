
import React, { useState } from 'react';
import { Currency } from '../types';
import { NFT_PRICES, PACK_SIZES, GETGEMS_URL } from '../constants';
import { createPayment, verifyPayment } from '../services/mockApi';
import { useTranslation } from '../i18n/LanguageContext';
import { useTonConnectUI } from '@tonconnect/ui-react';

interface ShopProps {
  onPurchaseComplete: () => void;
  userBalance: { [key in Currency]: number };
}

export const Shop: React.FC<ShopProps> = ({ onPurchaseComplete, userBalance }) => {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(Currency.TON);
  const [selectedPack, setSelectedPack] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [useRewardBalance, setUseRewardBalance] = useState(false);
  const { t } = useTranslation();
  const [tonConnectUI] = useTonConnectUI();

  // Safety fallback
  const safeBalance = userBalance || { STARS: 0, TON: 0, USDT: 0 };

  const handleBuy = async () => {
    setLoading(true);
    try {
      const paymentData = await createPayment('nft', selectedPack, selectedCurrency, useRewardBalance);

      if (!paymentData.ok) throw new Error(paymentData.error || "Failed to initiate payment");
      
      if (paymentData.isInternal) {
           await verifyPayment('nft', selectedPack, selectedCurrency, true);
           if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
           alert(t('success_purchase', { count: selectedPack }));
           onPurchaseComplete();
           setLoading(false);
           return;
      }

      if (selectedCurrency === Currency.STARS && paymentData.invoiceLink) {
         await new Promise<void>((resolve, reject) => {
             // Check for native support
             const hasNativeInvoice = !!window.Telegram?.WebApp?.openInvoice;
             // Check if it's the mock link
             const isMockLink = paymentData.invoiceLink === "https://t.me/$";

             if (hasNativeInvoice && !isMockLink && paymentData.invoiceLink) {
                 window.Telegram.WebApp.openInvoice(paymentData.invoiceLink, (status) => {
                     if (status === 'paid') resolve(); else reject(new Error("Invoice cancelled"));
                 });
             } else {
                 // Fallback for Preview or Mock
                 setTimeout(() => {
                     const confirmed = window.confirm("⭐️ Stars Mock Payment: Confirm purchase?");
                     if (confirmed) resolve(); else reject(new Error("Cancelled"));
                 }, 100);
             }
         });

      } else if (selectedCurrency !== Currency.STARS && paymentData.transaction) {
         if (!tonConnectUI.connected) {
             alert(t('connect_first')); 
             await tonConnectUI.openModal();
             setLoading(false); 
             return;
         }
         await tonConnectUI.sendTransaction(paymentData.transaction);
      }

      await verifyPayment('nft', selectedPack, selectedCurrency, useRewardBalance);
      
      if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
      }
      alert(t('success_purchase', { count: selectedPack }));
      onPurchaseComplete();

    } catch (e: any) {
      if (e.message === 'Cancelled' || e.message === 'Invoice cancelled') return;
      console.error(e);
      alert(t('fail_purchase') + (e.message ? `: ${e.message}` : '')); 
    } finally {
      setLoading(false);
    }
  };

  const openCollection = () => {
      if (window.Telegram?.WebApp?.openLink) {
          window.Telegram.WebApp.openLink(GETGEMS_URL);
      } else {
          window.open(GETGEMS_URL, '_blank');
      }
  };

  const pricePerUnit = NFT_PRICES[selectedCurrency];
  const totalPrice = parseFloat((pricePerUnit * selectedPack).toFixed(selectedCurrency === Currency.STARS ? 0 : 4));
  
  const currentBalance = safeBalance[selectedCurrency];
  const hasSomeBalance = currentBalance > 0;
  
  const discount = useRewardBalance ? Math.min(totalPrice, currentBalance) : 0;
  const payAmount = parseFloat((totalPrice - discount).toFixed(4));

  return (
    <div className="p-5 space-y-6 pb-24 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-500">
          {t('shop_title')}
        </h2>
        <p className="text-gray-400 text-sm">{t('shop_subtitle')}</p>
      </div>

      <div>
        <div className="relative mx-auto w-64 h-64">
            <div className="absolute inset-0 bg-blue-500 rounded-2xl blur-2xl opacity-20 animate-pulse"></div>
            <div className="relative aspect-square rounded-2xl overflow-hidden shadow-2xl border border-white/10 group">
                <img 
                    src="https://picsum.photos/600/600?random=8" 
                    alt="NFT Preview" 
                    className="object-cover w-full h-full transform transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
                <div className="absolute bottom-3 right-3 bg-white/10 backdrop-blur-md px-3 py-1 rounded-full text-xs font-medium border border-white/20">
                {t('lazy_mint')}
                </div>
            </div>
        </div>
        
        <div className="flex justify-center mt-5">
            <button 
                onClick={openCollection}
                className="flex items-center gap-2 text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors bg-blue-500/10 px-4 py-2 rounded-full border border-blue-500/20 hover:bg-blue-500/20 active:scale-95"
            >
                <span>💎</span>
                {t('collection_btn')}
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
        </div>
      </div>

      {/* Currency Selection - Compact */}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {(Object.values(Currency) as Currency[]).map((curr) => (
            <button
              key={curr}
              onClick={() => { setSelectedCurrency(curr); setUseRewardBalance(false); }}
              className={`relative py-3 rounded-xl text-sm font-bold border transition-all duration-200 ${
                selectedCurrency === curr
                  ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)] transform -translate-y-1'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-700 hover:border-gray-600'
              }`}
            >
              {curr === Currency.STARS ? 'STARS*' : curr}
              {selectedCurrency === curr && (
                <div className="absolute -top-2 -right-2 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-900"></div>
              )}
            </button>
          ))}
        </div>
        {selectedCurrency === Currency.STARS && (
            <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg">
                <span className="text-yellow-500 text-lg">⚠️</span>
                <p className="text-xs text-yellow-200/80 leading-tight pt-1">
                    {t('locked_warning')}
                </p>
            </div>
        )}
      </div>

      {/* Quantity Selection - Compact Grid */}
      <div>
        <div className="grid grid-cols-4 gap-2">
          {PACK_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setSelectedPack(size)}
              className={`py-4 rounded-xl text-sm font-bold border transition-all duration-200 ${
                selectedPack === size
                  ? 'bg-purple-600 border-purple-400 text-white shadow-lg transform -translate-y-1'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-700'
              }`}
            >
              x{size}
            </button>
          ))}
        </div>
      </div>

      {/* Total & Pay Button (Inline) */}
      <div className="flex gap-4 items-center mt-6 pt-4 border-t border-white/5">
            <div className="flex-1">
                <div className="text-xs text-gray-400 uppercase">{t('total')}</div>
                <div className="flex flex-col">
                    {useRewardBalance && discount > 0 ? (
                        <>
                            <div className="text-lg font-bold text-white leading-none">
                                {payAmount} <span className="text-sm text-gray-400">{selectedCurrency}</span>
                            </div>
                            <div className="text-[10px] text-green-400 font-mono">
                                + {discount} from Bonus
                            </div>
                        </>
                    ) : (
                        <div className="text-xl font-bold text-white leading-none">
                            {totalPrice} <span className="text-sm font-medium text-gray-400">{selectedCurrency}</span>
                        </div>
                    )}
                </div>
            </div>
            <button
            onClick={handleBuy}
            disabled={loading}
            className={`flex-[2] py-4 rounded-xl font-bold text-lg shadow-lg transition-all active:scale-95 flex justify-center items-center ${
                loading 
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                    : useRewardBalance && payAmount === 0
                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-green-900/20'
                        : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-blue-900/20'
            }`}
            >
            {loading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : (
                useRewardBalance && payAmount === 0 ? t('pay_full_balance') : t('pay_btn_short', { price: payAmount, currency: selectedCurrency })
            )}
            </button>
      </div>

      {/* Balance Payment Toggle (Below Pay Button) */}
      <div className={`bg-gray-800/80 p-3 rounded-xl border flex items-center justify-between transition-colors mt-2 ${useRewardBalance ? 'border-green-500/50 bg-green-900/10' : 'border-white/5'}`}>
          <div>
              <div className="text-xs text-gray-400 font-bold uppercase">{t('bonus_balance')}</div>
              <div className="text-sm font-bold text-white">
                  {parseFloat(currentBalance.toFixed(4))} <span className="text-gray-500">{selectedCurrency}</span>
              </div>
          </div>
          <button 
             onClick={() => hasSomeBalance && setUseRewardBalance(!useRewardBalance)}
             disabled={!hasSomeBalance}
             className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                 useRewardBalance 
                 ? 'bg-green-500 text-black border-green-500' 
                 : hasSomeBalance 
                    ? 'bg-gray-700 text-white hover:bg-gray-600 border-gray-600'
                    : 'bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed opacity-50'
             }`}
          >
              {useRewardBalance ? '✓ Apply' : t('pay_with_balance')}
          </button>
      </div>

    </div>
  );
};
