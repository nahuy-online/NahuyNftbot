import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { withdrawNFTWithAddress } from '../services/mockApi';
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';

interface ProfileProps {
  user: UserProfile;
  onUpdate: () => void;
}

export const Profile: React.FC<ProfileProps> = ({ user, onUpdate }) => {
  const [withdrawing, setWithdrawing] = useState(false);
  const userFriendlyAddress = useTonAddress();
  const [now, setNow] = useState(Date.now());

  // Update timer every minute to refresh countdowns
  useEffect(() => {
      const interval = setInterval(() => setNow(Date.now()), 60000);
      return () => clearInterval(interval);
  }, []);

  const handleWithdraw = async () => {
      const targetAddress = userFriendlyAddress || user.walletAddress;

      if (!targetAddress) {
          alert("Connect wallet first!");
          return;
      }
      if (user.nftBalance.available <= 0) {
          alert("No available NFTs to withdraw.");
          return;
      }
      
      const confirm = window.confirm(`Withdraw ${user.nftBalance.available} NFTs to ${targetAddress.slice(0,6)}...?`);
      if(confirm) {
          setWithdrawing(true);
          try {
            await withdrawNFTWithAddress(targetAddress);
            alert("Withdrawal request sent to blockchain!");
            onUpdate();
          } catch (e) {
            alert("Withdrawal failed: " + e);
          } finally {
            setWithdrawing(false);
          }
      }
  };

  const formatTimeLeft = (target: number) => {
      const diff = target - now;
      if (diff <= 0) return "Unlocking...";
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      return `${days}d ${hours}h`;
  };

  return (
    <div className="p-4 pb-24 space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold">
            {user.username ? user.username.charAt(0).toUpperCase() : 'U'}
        </div>
        <div>
            <h2 className="text-xl font-bold">@{user.username || 'User'}</h2>
            <p className="text-xs text-gray-500">ID: {user.id}</p>
        </div>
      </div>

      {/* Wallet Status */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="flex justify-between items-center mb-4">
              <span className="text-gray-400 text-sm">Wallet (TonConnect)</span>
              <span className={`text-xs px-2 py-1 rounded ${userFriendlyAddress ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                  {userFriendlyAddress ? 'Active' : 'Not Connected'}
              </span>
          </div>
          
          <div className="flex justify-center w-full">
            <TonConnectButton />
          </div>

          {userFriendlyAddress && (
              <div className="mt-4 p-2 bg-gray-900 rounded border border-gray-800">
                  <div className="text-xs text-gray-500 mb-1">Connected Address</div>
                  <div className="font-mono text-xs break-all text-gray-300">{userFriendlyAddress}</div>
              </div>
          )}
      </div>

      {/* NFT Balance */}
      <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Total NFT</div>
              <div className="text-2xl font-bold text-white">{user.nftBalance.total}</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 relative overflow-hidden">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Locked (Stars)</div>
              <div className="text-2xl font-bold text-yellow-500">{user.nftBalance.locked}</div>
              <div className="absolute top-0 right-0 p-1">
                  <span className="text-[10px] text-gray-500">21 days</span>
              </div>
          </div>
      </div>

      {/* Locked Details List */}
      {user.nftBalance.lockedDetails && user.nftBalance.lockedDetails.length > 0 && (
          <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700/50">
              <h4 className="text-xs font-bold text-gray-400 uppercase mb-3">Unlocking Schedule</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {user.nftBalance.lockedDetails.sort((a,b) => a.unlockDate - b.unlockDate).map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm bg-gray-900 p-2 rounded border border-gray-800">
                          <span className="font-bold text-white">{item.amount} NFT</span>
                          <span className="text-yellow-500 font-mono text-xs">
                              Opens in {formatTimeLeft(item.unlockDate)}
                          </span>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* Withdraw Section */}
      <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
          <div className="flex justify-between items-center mb-4">
              <span className="text-gray-300 font-medium">Available to Withdraw</span>
              <span className="text-xl font-bold text-green-400">{user.nftBalance.available}</span>
          </div>
          <button 
            onClick={handleWithdraw}
            disabled={withdrawing || user.nftBalance.available === 0}
            className={`w-full py-3 rounded-lg font-bold ${
                user.nftBalance.available > 0 
                ? 'bg-white text-black hover:bg-gray-200' 
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
              {withdrawing ? 'Minting...' : 'Lazy Mint -> Wallet'}
          </button>
      </div>

      {/* Referral Stats */}
      <div className="space-y-3 pt-4 border-t border-gray-800">
          <h3 className="font-bold text-lg">Referral Program (3 Levels)</h3>
          <div className="bg-gray-900 rounded-lg p-3 text-sm flex justify-between">
              <span className="text-gray-400">Link:</span>
              <span className="text-blue-400 font-mono cursor-pointer">t.me/nahuy_NFT_bot?start={user.id}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-gray-800 p-2 rounded">
                  <div className="text-gray-400">Lvl 1</div>
                  <div className="font-bold text-white">{user.referralStats.level1}</div>
              </div>
              <div className="bg-gray-800 p-2 rounded">
                  <div className="text-gray-400">Lvl 2</div>
                  <div className="font-bold text-white">{user.referralStats.level2}</div>
              </div>
              <div className="bg-gray-800 p-2 rounded">
                  <div className="text-gray-400">Lvl 3</div>
                  <div className="font-bold text-white">{user.referralStats.level3}</div>
              </div>
          </div>
          <div className="bg-gray-800 p-3 rounded-lg">
              <div className="text-xs text-gray-400 mb-2">Total Earnings</div>
              <div className="flex space-x-4 text-sm font-mono">
                  <span className="text-yellow-500">{user.referralStats.earnings.STARS} ★</span>
                  <span className="text-blue-400">{user.referralStats.earnings.TON} TON</span>
                  <span className="text-green-400">{user.referralStats.earnings.USDT} USDT</span>
              </div>
          </div>
      </div>
    </div>
  );
};