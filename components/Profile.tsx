import React, { useState } from 'react';
import { UserProfile, Currency } from '../types';
import { connectWallet, withdrawNFT } from '../services/mockApi';

interface ProfileProps {
  user: UserProfile;
  onUpdate: () => void;
}

export const Profile: React.FC<ProfileProps> = ({ user, onUpdate }) => {
  const [connecting, setConnecting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    await connectWallet();
    onUpdate();
    setConnecting(false);
  };

  const handleWithdraw = async () => {
      if (!user.walletAddress) {
          alert("Connect wallet first!");
          return;
      }
      if (user.nftBalance.available <= 0) {
          alert("No available NFTs to withdraw.");
          return;
      }
      
      const confirm = window.confirm(`Withdraw ${user.nftBalance.available} NFTs to ${user.walletAddress.slice(0,6)}...?`);
      if(confirm) {
          setWithdrawing(true);
          await withdrawNFT();
          onUpdate();
          setWithdrawing(false);
          alert("Withdrawal request sent to blockchain!");
      }
  };

  return (
    <div className="p-4 pb-24 space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold">
            {user.username.charAt(0).toUpperCase()}
        </div>
        <div>
            <h2 className="text-xl font-bold">@{user.username}</h2>
            <p className="text-xs text-gray-500">ID: {user.id}</p>
        </div>
      </div>

      {/* Wallet Status */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="flex justify-between items-center mb-2">
              <span className="text-gray-400 text-sm">Wallet (TonConnect)</span>
              <span className={`text-xs px-2 py-1 rounded ${user.walletAddress ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                  {user.walletAddress ? 'Connected' : 'Disconnected'}
              </span>
          </div>
          {user.walletAddress ? (
              <div className="font-mono text-sm break-all text-gray-300">{user.walletAddress}</div>
          ) : (
              <button 
                onClick={handleConnect}
                disabled={connecting}
                className="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                  {connecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
          )}
      </div>

      {/* NFT Balance */}
      <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Total NFT</div>
              <div className="text-2xl font-bold text-white">{user.nftBalance.total}</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Locked (Stars)</div>
              <div className="text-2xl font-bold text-yellow-500">{user.nftBalance.locked}</div>
          </div>
      </div>

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