
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

const FireworksEffect = () => {
    const particles = Array.from({ length: 50 }).map((_, i) => {
        let angle;
        if (Math.random() > 0.5) {
            angle = (-60 + Math.random() * 70) * (Math.PI / 180);
        } else {
            angle = (-120 - Math.random() * 70) * (Math.PI / 180);
        }
        const distance = 120 + Math.random() * 180; 
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;
        return { 
            id: i, tx: `${tx}px`, ty: `${ty}px`, 
            color: ['#FFD700', '#FFA500', '#FFFFFF', '#FF4500', '#00FFFF'][Math.floor(Math.random() * 5)],
            delay: Math.random() * 0.5
        };
    });
    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            {particles.map(p => (
                <div key={p.id} className="firework-particle shadow-[0_0_10px_currentColor]"
                    style={{ '--tx': p.tx, '--ty': p.ty, backgroundColor: p.color, color: p.color, animationDelay: `${p.delay}s`, width: Math.random() > 0.7 ? '4px' : '6px', height: Math.random() > 0.7 ? '4px' : '6px' } as React.CSSProperties} />
            ))}
            <div className="absolute w-40 h-40 bg-yellow-400/10 blur-[60px] rounded-full animate-pulse z-0"></div>
        </div>
    );
};

const ConfettiEffect = () => {
    const pieces = Array.from({ length: 40 }).map((_, i) => {
        let angle;
        if (Math.random() > 0.5) {
             angle = (-20 - Math.random() * 50) * (Math.PI / 180);
        } else {
             angle = (-160 + Math.random() * 50) * (Math.PI / 180);
        }
        const distance = 150 + Math.random() * 100;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;
        const rot = Math.random() * 720 - 360;
        return {
            id: i, tx: `${tx}px`, ty: `${ty}px`, rot: `${rot}deg`,
            color: ['#F472B6', '#34D399', '#60A5FA', '#FBBF24', '#A78BFA'][i % 5],
            delay: Math.random() * 0.3, duration: 3.5 + Math.random() 
        };
    });
    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            {pieces.map(p => (
                <div key={p.id} className="confetti-piece"
                    style={{ '--ctx': p.tx, '--cty': p.ty, '--crot': p.rot, backgroundColor: p.color, width: Math.random() > 0.5 ? '6px' : '4px', height: Math.random() > 0.5 ? '6px' : '10px', animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` } as React.CSSProperties} />
            ))}
        </div>
    );
};

const SparklesEffect = () => {
    // Distinct from confetti: Random static pops/pings instead of falling movement
    const sparkles = Array.from({ length: 25 }).map((_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        delay: Math.random() * 1.5,
        scale: 0.5 + Math.random()
    }));

    return (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-2xl">
             <div className="absolute inset-0 bg-cyan-500/10 animate-pulse rounded-2xl"></div>
             {sparkles.map(s => (
                 <div 
                    key={s.id} 
                    className="absolute bg-cyan-300 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-ping"
                    style={{ 
                        left: s.left, 
                        top: s.top, 
                        width: '4px', 
                        height: '4px', 
                        animationDuration: '1.2s',
                        animationDelay: `${s.delay}s` 
                    }} 
                 />
             ))}
             {sparkles.slice(0, 10).map(s => (
                 <div 
                    key={`static-${s.id}`} 
                    className="absolute text-white/60 animate-bounce"
                    style={{ 
                        left: s.left, 
                        top: s.top, 
                        fontSize: '10px',
                        animationDuration: '3s',
                        animationDelay: `${s.delay}s` 
                    }} 
                 >✦</div>
             ))}
        </div>
    );
};

// --- MAIN COMPONENT ---

export const DiceGame: React.FC<DiceGameProps> = ({ user, onUpdate }) => {
  const [view, setView] = useState<'play' | 'buy'>('play');
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const { t } = useTranslation();
  
  // 3D Rotation
  const [rotation, setRotation] = useState<{x: number, y: number}>({ x: 0, y: 0 });
  
  // Buy State
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(Currency.TON);
  const [selectedPack, setSelectedPack] = useState<number>(1);
  const [buyLoading, setBuyLoading] = useState(false);
  
  // Wallet
  const [tonConnectUI] = useTonConnectUI();

  useEffect(() => {
    if (!lastRoll) {
        setRotation({ x: -25, y: -25 });
    }
  }, []);

  const handleRoll = async () => {
    if (user.diceBalance.available <= 0) {
        if (window.Telegram?.WebApp?.HapticFeedback) {
             window.Telegram.WebApp.HapticFeedback.notificationOccurred('warning');
        }
        setView('buy');
        return;
    }

    setRolling(true);
    setLastRoll(null);
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }

    try {
        const delayPromise = new Promise(resolve => setTimeout(resolve, 800)); 
        const rollPromise = rollDice();
        const [, result] = await Promise.all([delayPromise, rollPromise]);
        
        // 3D Rotation Logic
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
            if (result >= 5) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            } else {
                window.Telegram.WebApp.HapticFeedback.impactOccurred('heavy');
            }
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
        // 1. Create Payment
        const paymentData = await createPayment('dice', selectedPack, selectedCurrency);
        if (!paymentData.ok) throw new Error("Payment init failed");

        // 2. Execute Payment
        if (selectedCurrency === Currency.STARS && paymentData.invoiceLink) {
             await new Promise<void>((resolve, reject) => {
                 // Detect Mock Link
                 const isMock = paymentData.invoiceLink === "https://t.me/$";
                 
                 if (isMock) {
                     console.log("Mock Payment Initiated");
                     setTimeout(() => {
                         const confirmed = window.confirm("Mock Payment (Stars): Confirm transaction?");
                         if (confirmed) resolve(); 
                         else reject(new Error("Cancelled"));
                     }, 300);
                     return;
                 }

                 if (window.Telegram?.WebApp) {
                     window.Telegram.WebApp.openInvoice(paymentData.invoiceLink!, (status) => {
                         if (status === 'paid') resolve();
                         else reject(new Error("Invoice cancelled"));
                     });
                 } else {
                     if(confirm("[MOCK] Pay with Stars?")) resolve(); else reject(new Error("Cancelled"));
                 }
             });
        } else if (selectedCurrency !== Currency.STARS && paymentData.transaction) {
             if (!tonConnectUI.connected) {
                 alert(t('connect_first'));
                 await tonConnectUI.openModal();
                 setBuyLoading(false);
                 return;
             }
             await tonConnectUI.sendTransaction(paymentData.transaction);
        }

        // 3. Verify
        await verifyPayment('dice', selectedPack, selectedCurrency);

        if (window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }
        alert(t('success_buy_attempts', { count: selectedPack }));
        onUpdate();
        setView('play');
    } catch (e: any) {
        if (e.message === 'Cancelled' || e.message === 'Invoice cancelled') {
            console.log("Purchase cancelled by user");
            return;
        }
        console.error(e);
        alert(t('fail_purchase'));
    } finally {
        setBuyLoading(false);
    }
  };

  const renderDots = (count: number) => {
      return Array.from({ length: count }).map((_, i) => (
          <div key={i} className="dot"></div>
      ));
  };

  if (view === 'buy') {
    const price = (DICE_ATTEMPT_PRICES[selectedCurrency] * selectedPack).toFixed(selectedCurrency === Currency.STARS ? 0 : 2);
    
    return (
        <div className="p-5 pb-44 animate-fade-in min-h-full">
            <button onClick={() => setView('play')} className="mb-6 px-4 py-2 bg-gray-800 rounded-lg text-sm text-gray-300 hover:text-white flex items-center w-fit transition-colors">
                {t('back_game')}
            </button>
            <div className="space-y-6">
                <div className="text-center">
                    <h2 className="text-2xl font-bold mb-1">{t('get_attempts')}</h2>
                    <p className="text-gray-400 text-sm">{t('buy_attempts_desc')}</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    {(Object.values(Currency) as Currency[]).map((curr) => (
                        <button
                        key={curr}
                        onClick={() => setSelectedCurrency(curr)}
                        className={`py-3 rounded-xl text-sm font-bold border transition-all ${
                            selectedCurrency === curr
                            ? 'bg-green-600 border-green-500 text-white shadow-lg'
                            : 'bg-gray-800 border-gray-700 text-gray-400'
                        }`}
                        >
                        {curr === Currency.STARS ? 'STARS*' : curr}
                        </button>
                    ))}
                </div>
                
                {selectedCurrency === Currency.STARS && (
                    <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg animate-fade-in">
                        <span className="text-yellow-500 text-lg">⚠️</span>
                        <p className="text-xs text-yellow-200/80 leading-tight pt-1">
                            {t('locked_attempts_warning')}
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-4 gap-2">
                {PACK_SIZES.map((size) => (
                    <button
                    key={size}
                    onClick={() => setSelectedPack(size)}
                    className={`py-4 rounded-xl text-sm font-bold border transition-all ${
                        selectedPack === size
                        ? 'bg-white text-black border-white shadow-lg'
                        : 'bg-gray-800 border-gray-700 text-gray-400'
                    }`}
                    >
                    {size}
                    </button>
                ))}
                </div>

                <div className="fixed bottom-24 left-0 right-0 px-5 max-w-md mx-auto z-40 pb-safe">
                    <button
                        onClick={handleBuyAttempts}
                        disabled={buyLoading}
                        className="w-full py-4 rounded-xl font-bold text-lg bg-green-500 hover:bg-green-400 text-white shadow-[0_0_20px_rgba(34,197,94,0.3)] transition-all active:scale-95 disabled:opacity-50"
                    >
                        {buyLoading ? t('processing') : t('pay_btn', { price, currency: selectedCurrency })}
                    </button>
                </div>
            </div>
        </div>
    );
  }

  // --- LOGIC: Calculate actual win amount based on roll ---
  // EXACT LOGIC: Roll value = Amount
  const getWinAmount = (roll: number) => {
      return roll; // 1->1, 2->2, ..., 6->6
  };

  // Result config logic
  const getResultConfig = (roll: number) => {
      // 6: Gold, Legendary only
      // SWAPPED: Main Text = JACKPOT, Sub Text = LEGENDARY
      if (roll === 6) return { bg: 'bg-gradient-to-r from-yellow-600 to-amber-500', border: 'border-yellow-300', shadow: 'shadow-[0_0_30px_rgba(250,204,21,0.5)]', text: t('win_jackpot'), subtext: t('win_legendary'), Effect: FireworksEffect, icon: '👑', iconAnim: 'animate-bounce' };
      
      // 5: Purple, Amazing
      if (roll === 5) return { bg: 'bg-gradient-to-r from-purple-600 to-pink-500', border: 'border-pink-300', shadow: 'shadow-[0_0_25px_rgba(236,72,153,0.5)]', text: t('win_amazing'), subtext: t('win_epic'), Effect: ConfettiEffect, icon: '🎉', iconAnim: 'animate-spin-slow' };
      
      // 4: Blue/Cyan, Great Win
      // UPDATED EFFECT: SparklesEffect
      if (roll === 4) return { bg: 'bg-gradient-to-r from-blue-600 to-cyan-500', border: 'border-cyan-300', shadow: 'shadow-[0_0_20px_rgba(6,182,212,0.5)]', text: t('win_great'), subtext: t('win_rare'), Effect: SparklesEffect, icon: '✨', iconAnim: 'animate-pulse' };

      // 3: Green, Nice Catch
      if (roll === 3) return { bg: 'bg-gradient-to-r from-green-600 to-emerald-600', border: 'border-green-400', shadow: 'shadow-[0_0_15px_rgba(74,222,128,0.3)]', text: t('win_basic'), subtext: t('win_nice'), Effect: null, icon: '🎲', iconAnim: 'animate-pulse' };

      // 2: Green, Could be worse
      if (roll === 2) return { bg: 'bg-gradient-to-r from-green-600 to-emerald-600', border: 'border-green-400', shadow: 'shadow-[0_0_15px_rgba(74,222,128,0.3)]', text: t('win_basic'), subtext: t('win_2_sub'), Effect: null, icon: '🎲', iconAnim: 'animate-pulse' };

      // 1: Green, It happens
      return { bg: 'bg-gradient-to-r from-green-600 to-emerald-600', border: 'border-green-400', shadow: 'shadow-[0_0_15px_rgba(74,222,128,0.3)]', text: t('win_basic'), subtext: t('win_1_sub'), Effect: null, icon: '🎲', iconAnim: 'animate-pulse' };
  };

  const resultConfig = lastRoll ? getResultConfig(lastRoll) : null;
  const winAmount = lastRoll ? getWinAmount(lastRoll) : 0;

  return (
    <div className="p-4 flex flex-col items-center justify-center min-h-[75vh] pb-24 relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-64 h-64 bg-green-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="text-center mb-8 z-10">
        <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-500 mb-2 italic">
            {t('lucky_dice')}
        </h1>
        <p className="text-gray-400 font-medium">{t('roll_slogan')}</p>
      </div>

      <div className="flex flex-col items-center w-full max-w-xs z-10">
          
          {/* 3D Dice Scene */}
          <div className="scene mb-8">
            <div className="cube" style={{ transform: `translateZ(-50px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)` }}>
                <div className="cube-face face-1"><div className="dot-container">{renderDots(1)}</div></div>
                <div className="cube-face face-2"><div className="dot-container">{renderDots(2)}</div></div>
                <div className="cube-face face-3"><div className="dot-container">{renderDots(3)}</div></div>
                <div className="cube-face face-4"><div className="dot-container">{renderDots(4)}</div></div>
                <div className="cube-face face-5"><div className="dot-container">{renderDots(5)}</div></div>
                <div className="cube-face face-6"><div className="dot-container">{renderDots(6)}</div></div>
            </div>
          </div>
          
          {/* Result Message Area */}
          <div className="h-24 mb-10 w-full flex items-center justify-center relative">
             {lastRoll && !rolling && resultConfig ? (
                <div className="relative w-full flex justify-center items-center animate-pop-in">
                    {resultConfig.Effect && <resultConfig.Effect />}
                    <div className={`relative z-10 flex items-center gap-4 px-6 py-4 rounded-2xl border ${resultConfig.bg} ${resultConfig.border} ${resultConfig.shadow} text-white transition-all duration-300 w-[90%] justify-center min-h-[86px]`}>
                        <span className={`text-4xl filter drop-shadow-md ${resultConfig.iconAnim} leading-none flex items-center`}>{resultConfig.icon}</span>
                        <div className="flex flex-col items-start">
                            <span className="text-[10px] uppercase font-bold tracking-widest opacity-90">{resultConfig.subtext}</span>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-2xl font-black italic tracking-wide whitespace-nowrap">{resultConfig.text}</span>
                                {winAmount > 0 && <span className="text-sm font-bold bg-white/20 px-1.5 rounded">+{winAmount} NFT</span>}
                            </div>
                        </div>
                        <div className="shimmer opacity-30 rounded-2xl overflow-hidden pointer-events-none"></div>
                    </div>
                </div>
             ) : rolling ? (
                 <div className="text-green-400/80 font-mono font-medium tracking-widest animate-pulse flex flex-col items-center">
                    <span>{t('rolling')}</span>
                    <span className="text-xs opacity-50 mt-1">{t('good_luck')}</span>
                 </div>
             ) : (
                 <div className="text-gray-600 text-sm font-medium">{t('test_luck')}</div>
             )}
          </div>

          {/* Controls */}
          <div className="w-full space-y-4">
            <button
                onClick={handleRoll}
                disabled={rolling}
                className={`w-full py-5 rounded-2xl font-bold text-xl shadow-xl transition-all active:scale-95 border border-white/5 relative overflow-hidden group ${
                    rolling ? 'bg-gray-700 cursor-wait' : 'bg-white text-black hover:bg-gray-100'
                }`}
            >
                <span className="relative z-10">{rolling ? t('wait_btn') : t('roll_btn')}</span>
                {!rolling && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500"></div>}
            </button>

            <div className="flex justify-between items-center bg-gray-800/50 px-5 py-3 rounded-xl border border-white/5">
                <span className="text-gray-400 text-sm font-medium">{t('attempts_left')}</span>
                <span className={`font-mono font-bold text-lg ${user.diceBalance.available === 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {user.diceBalance.available}
                </span>
            </div>

            {user.diceBalance.available === 0 && (
                <button
                    onClick={() => setView('buy')}
                    className="w-full py-3 rounded-xl font-medium text-sm text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-colors"
                >
                    {t('buy_more_btn')}
                </button>
            )}
          </div>
      </div>
    </div>
  );
};
