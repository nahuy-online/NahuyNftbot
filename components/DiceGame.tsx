import React, { useState } from 'react';
import { Currency, UserProfile } from '../types';
import { DICE_ATTEMPT_PRICES, PACK_SIZES } from '../constants';
import { purchaseItem, rollDice } from '../services/mockApi';

interface DiceGameProps {
  user: UserProfile;
  onUpdate: () => void;
}

export const DiceGame: React.FC<DiceGameProps> = ({ user, onUpdate }) => {
  const [view, setView] = useState<'play' | 'buy'>('play');
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  
  // Buy State
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(Currency.STARS);
  const [selectedPack, setSelectedPack] = useState<number>(1);
  const [buyLoading, setBuyLoading] = useState(false);

  const handleRoll = async () => {
    if (user.diceBalance.available <= 0) {
        setView('buy');
        return;
    }

    setRolling(true);
    setLastRoll(null);

    try {
        const result = await rollDice();
        // Wait for visual animation
        setTimeout(() => {
            setLastRoll(result);
            setRolling(false);
            onUpdate();
        }, 1000); 
    } catch (e) {
        setRolling(false);
        alert("Error rolling dice");
    }
  };

  const handleBuyAttempts = async () => {
    setBuyLoading(true);
    try {
        await purchaseItem('dice', selectedPack, selectedCurrency);
        alert(`Bought ${selectedPack} attempts!`);
        onUpdate();
        setView('play');
    } catch (e) {
        alert("Purchase failed");
    } finally {
        setBuyLoading(false);
    }
  };

  if (view === 'buy') {
    const price = (DICE_ATTEMPT_PRICES[selectedCurrency] * selectedPack).toFixed(selectedCurrency === Currency.STARS ? 0 : 2);
    return (
        <div className="p-4 pb-24 animate-fade-in">
            <button onClick={() => setView('play')} className="mb-4 text-sm text-gray-400 hover:text-white flex items-center">
                ← Back to Game
            </button>
            <h2 className="text-xl font-bold mb-6">Buy Attempts</h2>
             {/* Currency Selector */}
            <div className="grid grid-cols-3 gap-2 mb-6">
            {Object.values(Currency).map((curr) => (
                <button
                key={curr}
                onClick={() => setSelectedCurrency(curr)}
                className={`py-2 rounded-lg text-sm font-bold border ${
                    selectedCurrency === curr
                    ? 'bg-green-600 border-green-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400'
                }`}
                >
                {curr}
                </button>
            ))}
            </div>
             {/* Pack Selector */}
            <div className="grid grid-cols-4 gap-2 mb-6">
            {PACK_SIZES.map((size) => (
                <button
                key={size}
                onClick={() => setSelectedPack(size)}
                className={`py-3 rounded-lg text-sm font-bold border ${
                    selectedPack === size
                    ? 'bg-gray-200 text-black border-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400'
                }`}
                >
                {size}
                </button>
            ))}
            </div>

            <button
                onClick={handleBuyAttempts}
                disabled={buyLoading}
                className="w-full py-4 rounded-xl font-bold text-lg bg-green-600 text-white shadow-lg"
            >
                {buyLoading ? 'Processing...' : `Pay ${price} ${selectedCurrency}`}
            </button>
        </div>
    );
  }

  // Play View
  return (
    <div className="p-4 flex flex-col items-center justify-center min-h-[80vh] pb-24">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Lucky Dice</h1>
        <p className="text-gray-400">Roll 1-6. Win NFTs equal to your roll!</p>
      </div>

      <div className="bg-gray-800 rounded-2xl p-8 mb-8 w-full max-w-xs flex flex-col items-center border border-gray-700 shadow-2xl">
        <div className={`text-9xl mb-4 transition-transform ${rolling ? 'dice-animation blur-sm' : ''}`}>
           {lastRoll ? (
               // Simple emoji logic for dice faces
               ['','⚀','⚁','⚂','⚃','⚄','⚅'][lastRoll]
           ) : '🎲'}
        </div>
        
        {lastRoll && !rolling && (
            <div className="text-green-400 font-bold text-lg animate-bounce">
                You won {lastRoll} NFT{lastRoll > 1 ? 's' : ''}!
            </div>
        )}
      </div>

      <div className="w-full max-w-xs space-y-3">
        <button
            onClick={handleRoll}
            disabled={rolling}
            className={`w-full py-4 rounded-xl font-bold text-xl shadow-lg transition-all ${
                rolling ? 'bg-gray-600' : 'bg-white text-black hover:bg-gray-200'
            }`}
        >
            {rolling ? 'Rolling...' : 'ROLL DICE'}
        </button>

        <div className="text-center">
            <span className="text-gray-400">Attempts left: </span>
            <span className={`font-mono font-bold ${user.diceBalance.available === 0 ? 'text-red-500' : 'text-white'}`}>
                {user.diceBalance.available}
            </span>
        </div>

        {user.diceBalance.available === 0 && (
             <button
                onClick={() => setView('buy')}
                className="w-full py-2 rounded-lg font-medium text-sm text-green-400 border border-green-400/30 hover:bg-green-400/10"
            >
                + Buy More Attempts
            </button>
        )}
      </div>
    </div>
  );
};