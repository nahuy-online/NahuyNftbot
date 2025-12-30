import React, { useState } from 'react';
import { Currency } from '../types';
import { NFT_PRICES, PACK_SIZES } from '../constants';
import { createPayment, verifyPayment } from '../services/mockApi';
import { useTranslation } from '../i18n/LanguageContext';
import { useTonConnectUI } from '@tonconnect/ui-react';

interface ShopProps {
  onPurchaseComplete: () => void;
}

export const Shop: React.FC<ShopProps> = ({ onPurchaseComplete }) => {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(Currency.TON);
  const [selectedPack, setSelectedPack] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const [tonConnectUI] = useTonConnectUI();

  const handleBuy = async () => {
    setLoading(true);
    try {
      // 1. Init Payment
      const paymentData = await createPayment('nft', selectedPack, selectedCurrency);

      if (!paymentData.ok) throw new Error("Failed to initiate payment");

      // 2. Execute Payment
      if (selectedCurrency === Currency.STARS && paymentData.invoiceLink) {
         // --- TELEGRAM STARS ---
         await new Promise<void>((resolve, reject) => {
             if (window.Telegram?.WebApp) {
                 window.Telegram.WebApp.openInvoice(paymentData.invoiceLink!, (status) => {
                     if (status === 'paid') {
                         resolve();
                     } else {
                         reject(new Error("Invoice cancelled"));
                     }
                 });
             } else {
                 alert("Telegram WebApp not available. Cannot pay with Stars.");
                 reject(new Error("Environment error"));
             }
         });

      } else if (selectedCurrency !== Currency.STARS && paymentData.transaction) {
         // --- TON / USDT via TonConnect ---
         if (!tonConnectUI.connected) {
             alert(t('connect_first'));
             await tonConnectUI.openModal();
             setLoading(false); 
             return;
         }
         
         await tonConnectUI.sendTransaction(paymentData.transaction);
      }

      // 3. Verify Payment
      await verifyPayment('nft', selectedPack, selectedCurrency);
      
      if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
      }
      
      alert(t('success_purchase', { count: selectedPack }));
      onPurchaseComplete();

    } catch (e: any) {
      if (e.message === 'Cancelled' || e.message === 'Invoice cancelled') {
          return;
      }
      console.error(e);
      if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
      }
      alert(t('fail_purchase')); 
    } finally {
      setLoading(false);
    }
  };

  const pricePerUnit = NFT_PRICES[selectedCurrency];
  const totalPrice = (pricePerUnit * selectedPack).toFixed(selectedCurrency === Currency.STARS ? 0 : 2);

  return (
    <div className="p-5 space-y-8 pb-44 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-500">
          {t('shop_title')}
        </h2>
        <p className="text-gray-400 text-sm">{t('shop_subtitle')}</p>
      </div>

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

      <div className="space-y-3">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('select_currency')}</label>
        <div className="grid grid-cols-3 gap-3">
          {(Object.values(Currency) as Currency[]).map((curr) => (
            <button
              key={curr}
              onClick={() => setSelectedCurrency(curr)}
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

      <div className="space-y-3">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">{t('quantity')}</label>
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide snap-x">
          {PACK_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setSelectedPack(size)}
              className={`flex-1 min-w-[70px] py-4 rounded-xl text-sm font-bold border transition-all duration-200 snap-center ${
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

      <div className="fixed bottom-[65px] left-0 right-0 p-4 bg-gray-900/95 backdrop-blur-lg border-t border-white/10 z-40 pb-safe">
        <div className="max-w-md mx-auto flex gap-4 items-center">
            <div className="flex-1">
                <div className="text-xs text-gray-400 uppercase">{t('total')}</div>
                <div className="text-xl font-bold text-white leading-none">
                    {totalPrice} <span className="text-sm font-medium text-gray-400">{selectedCurrency}</span>
                </div>
            </div>
            <button
            onClick={handleBuy}
            disabled={loading}
            className={`flex-[2] py-4 rounded-xl font-bold text-lg shadow-lg transition-all active:scale-95 flex justify-center items-center ${
                loading 
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-blue-900/20'
            }`}
            >
            {loading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            ) : (
                t('purchase_btn')
            )}
            </button>
        </div>
      </div>
    </div>
  );
};