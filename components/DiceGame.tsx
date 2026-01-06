
import React, { useState, useEffect } from 'react';
import { Currency, UserProfile } from '../types';
import { DICE_ATTEMPT_PRICES, PACK_SIZES } from '../constants';
import { createPayment, verifyPayment, rollDice } from '../services/mockApi';
import { useTranslation } from '../i18n/LanguageContext';
import { useTonConnectUI } from '@tonconnect/ui-react';

interface DiceGameProps {
  user: UserProfile;
  onUpdate: () => void;
}

// --- VISUAL EFFECTS ---
const getSafeAngle = () => {
    const isRight = Math.random() > 0.5;
    if (isRight) { return (-15 - Math.random() * 60) * (Math.PI / 180); } 
    else { return (-105 - Math.random() * 60) * (Math.PI / 180); }
};

const FireworksEffect = () => {
    const particles = Array.from({ length: 90 }).map((_, i) => {
        const angleRad = getSafeAngle();
        const angleDeg = angleRad * (180 / Math.PI);
        const distance = 160 + Math.random() * 180;
        const tx = Math.cos(angleRad) * distance;
        const ty = Math.sin(angleRad) * distance;
        const rotation = angleDeg + 90;
        return { 
            id: i, tx: `${tx}px`, ty: `${ty}px`, rot: `${rotation}deg`,
            color: ['#FFD700', '#FFA500', '#FF4500', '#FF8C00'][Math.floor(Math.random() * 4)],
            delay: Math.random() * 0.4
        };
    });
    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            {particles.map(p => (
                <div key={p.id} className="firework-streak"
                    style={{ '--tx': p.tx, '--ty': p.ty, '--rot': p.rot, color: p.color, animationDelay: `${p.delay}s`, animationDuration: '3s' } as React.CSSProperties} />
            ))}
            <div className="absolute w-40 h-40 bg-orange-500/20 blur-[60px] rounded-full animate-pulse z-0"></div>
        </div>
    );
};

const ConfettiEffect = () => {
    const pieces = Array.from({ length: 50 }).map((_, i) => {
        const angleRad = getSafeAngle();
        const distance = 160 + Math.random() * 180;
        const tx = Math.cos(angleRad) * distance;
        const ty = Math.sin(angleRad) * distance;
        return {
            id: i, tx: `${tx}px`, ty: `${ty}px`, 
            color: ['#F472B6', '#34D399', '#60A5FA', '#FBBF24', '#A78BFA'][i % 5],
            delay: Math.random() * 0.3
        };
    });
    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            {pieces.map(p => (
                <div key={p.id} className="confetti-piece"
                    style={{ '--tx': p.tx, '--ty': p.ty, backgroundColor: p.color, width: Math.random() > 0.5 ? '6px' : '4px', height: Math.random() > 0.5 ? '8px' : '12px', animationDelay: `${p.delay}s`, animationDuration: '3s' } as React.CSSProperties} />
            ))}
        </div>
    );
};

const SparklesEffect = () => {
    const stars = Array.from({ length: 45 }).map((_, i) => {
        const angleRad = getSafeAngle();
        const distance = 160 + Math.random() * 180;
        const tx = Math.cos(angleRad) * distance;
        const ty = Math.sin(angleRad) * distance;
        return {
            id: i, tx: `${tx}px`, ty: `${ty}px`, scale: 0.5 + Math.random() * 0.8,
            delay: Math.random() * 0.5, color: ['#22d3ee', '#a5f3fc', '#ffffff'][Math.floor(Math.random() * 3)]
        };
    });
    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
             <div className="absolute w-40 h-40 bg-cyan-400/10 blur-[50px] rounded-full animate-pulse"></div>
             {stars.map(s => (
                 <div key={s.id} className="sparkle-star"
                    style={{ '--tx': s.tx, '--ty': s.ty, color: s.color, fontSize: `${14 * s.scale}px`, animationDelay: `${s.delay}s`, animationDuration: '3s' } as React.CSSProperties} >
                    {Math.random() > 0.6 ? '✦' : '★'}
                 </div>
             ))}
        </div>
    );
};

export const DiceGame: React.FC<DiceGameProps> = ({ user, onUpdate }) => {
  const [view, setView] = useState<'play' | 'buy'>('play');
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const { t } = useTranslation();
  
  const [rotation, setRotation] = useState<{x: number, y: number}>({ x: 0, y: 0 });
  
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(Currency.TON);
  const [selectedPack, setSelectedPack] = useState<number>(1);
  const [buyLoading, setBuyLoading] = useState(false);
  const [useRewardBalance, setUseRewardBalance] = useState(false);
  
  const [tonConnectUI] = useTonConnectUI();

  useEffect(() => {
    if (!lastRoll) setRotation({ x: -25, y: -25 });
  }, []);

  const handleRoll = async () => {
    if (user.diceBalance.available <= 0) {
        if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.notificationOccurred('warning');
        setView('buy');
        return;
    }

    setRolling(true);
    setLastRoll(null);
    if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');

    try {
        const delayPromise = new Promise(resolve => setTimeout(resolve, 800)); 
        const rollPromise = rollDice();
        const [, result] = await Promise.all([delayPromise, rollPromise]);
        
        const faceRotations: Record<number, {x: number, y: number}> = {
            1: { x: 0, y: 0 }, 2: { x: 0, y: 90 }, 3: { x: -90, y: 0 },
            4: { x: 90, y: 0 }, 5: { x: 0, y: -90 }, 6: { x: 180, y: 0 }
        };
        const targetFace = faceRotations[result];
        const minSpins = 4;
        const addDeg = minSpins * 360;
        let nextX = targetFace.x;
        while (nextX < rotation.x + addDeg) nextX += 360;
        let nextY = targetFace.y;
        while (nextY < rotation.y + addDeg) nextY += 360;
        if (Math.random() > 0.5) nextX += 360;
        if (Math.random() > 0.5) nextY += 360;

        setRotation({ x: nextX, y: nextY });
        await new Promise(resolve => setTimeout(resolve, 1600));

        setLastRoll(result);
        onUpdate(); 
        
        if (window.Telegram?.WebApp?.HapticFeedback) {
            if (result >= 4) window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            else window.Telegram.WebApp.HapticFeedback.impactOccurred('heavy');
        }

    } catch (e) {
        alert(t('error_roll'));
    } finally {
        setRolling(false);
    }
  };

  const handleBuyAttempts = async () => {
    setBuyLoading(true);
    try {
        const paymentData = await createPayment('dice', selectedPack, selectedCurrency, useRewardBalance);
        if (!paymentData.ok) throw new Error(paymentData.error || "Payment init failed");

        if (paymentData.isInternal) {
             await verifyPayment('dice', selectedPack, selectedCurrency, true);
             if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
             alert(t('success_buy_attempts', { count: selectedPack }));
             onUpdate();
             setView('play');
             setBuyLoading(false);
             return;
        }

        if (selectedCurrency === Currency.STARS && paymentData.invoiceLink) {
             const isMock = paymentData.invoiceLink === "https://t.me/$";
             
             if (isMock) {
                 // Direct Mock Simulation
                 let confirmed = true;
                 try {
                     confirmed = window.confirm("⭐️ Stars Payment (Simulation): Confirm purchase?");
                 } catch (e) {
                     // If confirm is blocked (e.g. in some iframes), auto-confirm for dev convenience
                     console.warn("Auto-confirming mock payment due to environment restriction.");
                 }
                 if (!confirmed) throw new Error("Cancelled");
                 // Proceed to verify
             } else {
                 // Real Telegram Flow
                 await new Promise<void>((resolve, reject) => {
                     if (window.Telegram?.WebApp?.openInvoice) {
                         window.Telegram.WebApp.openInvoice(paymentData.invoiceLink!, (status) => {
                             if (status === 'paid') resolve();
                             else reject(new Error("Invoice cancelled"));
                         });
                     } else {
                         reject(new Error("Telegram WebApp not available"));
                     }
                 });
             }
             
        } else if (selectedCurrency !== Currency.STARS && paymentData.transaction) {
             if (!tonConnectUI.connected) {
                 alert(t('connect_first'));
                 await tonConnectUI.openModal();
                 setBuyLoading(false);
                 return;
             }
             await tonConnectUI.sendTransaction(paymentData.transaction);
        }

        await verifyPayment('dice', selectedPack, selectedCurrency, useRewardBalance);

        if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        alert(t('success_buy_attempts', { count: selectedPack }));
        onUpdate();
        setView('play');
    } catch (e: any) {
        if (e.message === 'Cancelled' || e.message === 'Invoice cancelled') return;
        alert(t('fail_purchase') + (e.message ? `: ${e.message}` : ''));
    } finally {
        setBuyLoading(false);
    }
  };

  const renderDots = (count: number) => {
      return Array.from({ length: count }).map((_, i) => <div key={i} className="dot"></div>);
  };

  if (view === 'buy') {
    const totalPrice = parseFloat((DICE_ATTEMPT_PRICES[selectedCurrency] * selectedPack).toFixed(selectedCurrency === Currency.STARS ? 0 : 4));
    
    // Check balance for Pay with Bonus
    const currentBalance = user.referralStats.bonusBalance[selectedCurrency];
    const hasSomeBalance = currentBalance > 0;
    
    const discount = useRewardBalance ? Math.min(totalPrice, currentBalance) : 0;
    const payAmount = parseFloat((totalPrice - discount).toFixed(4));

    return (
        <div className="p-5 pb-24 animate-fade-in min-h-full flex flex-col items-center">
            <button onClick={() => setView('play')} className="mb-6 px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300 hover:text-white flex items-center w-fit transition-colors self-start">
                {t('back_game')}
            </button>
            <div className="space-y-6 w-full max-w-sm">
                <div className="text-center">
                    <h2 className="text-2xl font-bold mb-1">{t('get_attempts')}</h2>
                    <p className="text-gray-400 text-sm">{t('buy_attempts_desc')}</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    {(Object.values(Currency) as Currency[]).map((curr) => (
                        <button key={curr} onClick={() => { setSelectedCurrency(curr); setUseRewardBalance(false); }}
                        className={`py-3 rounded-xl text-sm font-bold border transition-all ${
                            selectedCurrency === curr ? 'bg-green-600 border-green-500 text-white shadow-lg' : 'bg-gray-800 border-gray-700 text-gray-400'
                        }`}>
                        {curr === Currency.STARS ? 'STARS*' : curr}
                        </button>
                    ))}
                </div>
                
                {selectedCurrency === Currency.STARS && (
                    <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg animate-fade-in">
                        <span className="text-yellow-500 text-lg">⚠️</span>
                        <p className="text-xs text-yellow-200/80 leading-tight pt-1">{t('locked_attempts_warning')}</p>
                    </div>
                )}

                <div className="grid grid-cols-4 gap-2">
                {PACK_SIZES.map((size) => (
                    <button key={size} onClick={() => setSelectedPack(size)}
                    className={`py-4 rounded-xl text-sm font-bold border transition-all ${
                        selectedPack === size ? 'bg-white text-black border-white shadow-lg' : 'bg-gray-800 border-gray-700 text-gray-400'
                    }`}>
                    {size}
                    </button>
                ))}
                </div>

                {/* Total & Pay Button */}
                <div className="flex gap-4 items-center mt-6 pt-4 border-t border-white/5 animate-fade-in">
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
                        onClick={handleBuyAttempts}
                        disabled={buyLoading}
                        className={`flex-[2] py-4 rounded-xl font-bold text-lg shadow-lg transition-all active:scale-95 flex justify-center items-center ${
                            buyLoading 
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                                : useRewardBalance && payAmount === 0
                                    ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-green-900/20'
                                    : 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/20'
                        }`}
                    >
                        {buyLoading ? (
                            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        ) : (
                            useRewardBalance && payAmount === 0 ? t('pay_full_balance') : t('pay_btn_short', { price: payAmount, currency: selectedCurrency })
                        )}
                    </button>
                </div>

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
        </div>
    );
  }

  // GAME VIEW - Centered Flex Column (Standard Layout)
  return (
    <div className="flex flex-col items-center justify-center min-h-[85vh] p-5 pb-24 relative overflow-hidden">
      
      {/* BACKGROUND EFFECTS (Z-0) */}
      {lastRoll === 6 && <FireworksEffect />}
      {lastRoll === 5 && <ConfettiEffect />}
      {lastRoll === 4 && <SparklesEffect />}
      
      {/* HEADER - CENTERED */}
      <div className="z-10 text-center mb-8">
          <h1 className="text-3xl font-black italic tracking-tighter text-white drop-shadow-[0_2px_10px_rgba(255,255,255,0.2)]">
              {t('lucky_dice')}
          </h1>
          <p className="text-sm font-bold text-blue-400 uppercase tracking-widest opacity-80 mt-1">{t('roll_slogan')}</p>
      </div>

      {/* 3D DICE SCENE */}
      <div className="scene z-20 mb-10">
          <div className="cube" style={{ 
              transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)` 
          }}>
              <div className="cube-face face-1"><div className="dot-container">{renderDots(1)}</div></div>
              <div className="cube-face face-2"><div className="dot-container">{renderDots(2)}</div></div>
              <div className="cube-face face-3"><div className="dot-container">{renderDots(3)}</div></div>
              <div className="cube-face face-4"><div className="dot-container">{renderDots(4)}</div></div>
              <div className="cube-face face-5"><div className="dot-container">{renderDots(5)}</div></div>
              <div className="cube-face face-6"><div className="dot-container">{renderDots(6)}</div></div>
          </div>
      </div>

      {/* RESULT TEXT */}
      <div className="h-20 flex flex-col items-center justify-center z-20 mb-2">
          {rolling ? (
              <div className="text-xl font-black text-gray-500 tracking-[0.2em] animate-pulse">{t('rolling')}</div>
          ) : lastRoll ? (
              <div className="text-center animate-pop-in">
                  <div className={`text-4xl font-black drop-shadow-lg ${
                      lastRoll === 6 ? 'text-yellow-400' : 
                      lastRoll === 5 ? 'text-purple-400' : 
                      lastRoll === 4 ? 'text-blue-400' : 
                      lastRoll === 3 ? 'text-green-400' : 'text-gray-300'
                  }`}>
                      {lastRoll === 6 ? t('win_jackpot') : 
                       lastRoll === 5 ? t('win_legendary') : 
                       lastRoll === 4 ? t('win_epic') : 
                       lastRoll === 3 ? t('win_great') : 
                       lastRoll === 2 ? t('win_basic') : t('win_nice')}
                  </div>
                  <div className="text-sm font-bold text-white/50 mt-1">
                       {lastRoll === 6 ? t('win_amazing') : 
                        lastRoll === 5 ? t('win_great') : 
                        lastRoll === 4 ? t('win_rare') : 
                        lastRoll === 3 ? t('win_basic') : 
                        lastRoll === 2 ? t('win_2_sub') : t('win_1_sub')}
                  </div>
                  {lastRoll > 0 && (
                      <div className="mt-2 text-xs font-mono text-green-400 bg-green-900/20 px-3 py-1 rounded-full border border-green-500/20">
                          +{lastRoll} NFT Won!
                      </div>
                  )}
              </div>
          ) : (
              <div className="text-gray-500 font-medium">{t('good_luck')}</div>
          )}
      </div>

      {/* ACTION BUTTON & INFO */}
      <div className="w-full max-w-[220px] z-20 flex flex-col items-center gap-4">
          <button 
            onClick={handleRoll} 
            disabled={rolling}
            className={`w-full py-4 rounded-xl font-black text-xl shadow-xl transition-all transform active:scale-95 ${
                rolling 
                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                : 'bg-white text-black hover:bg-gray-200 relative overflow-hidden'
            }`}
          >
              {user.diceBalance.available > 0 && !rolling && (
                  <div className="shimmer"></div>
              )}
              {rolling ? t('wait_btn') : t('roll_btn')}
          </button>
          
          <div className="w-full bg-gray-800/50 p-3 rounded-xl border border-white/5 flex items-center justify-between">
              <span className="text-xs text-gray-400 uppercase font-bold">{t('attempts_left')}</span>
              <span className={`text-xl font-black ${user.diceBalance.available > 0 ? 'text-green-400' : 'text-red-500'}`}>
                  {user.diceBalance.available}
              </span>
          </div>

          <button onClick={() => setView('buy')} className="w-full py-3 bg-green-600/20 border border-green-500/30 text-green-400 rounded-xl font-bold text-sm hover:bg-green-600/30 transition-colors">
              {t('buy_more_btn')}
          </button>
      </div>

    </div>
  );
};
