import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n/LanguageContext';

interface WelcomeProps {
    onComplete: (manualRefCode?: string) => void;
    initialRefParam?: string;
}

export const Welcome: React.FC<WelcomeProps> = ({ onComplete, initialRefParam }) => {
    const { t } = useTranslation();
    const [inviteCode, setInviteCode] = useState('');
    const [agreed, setAgreed] = useState(false);
    
    useEffect(() => {
        // If we have a start param from Telegram, pre-fill it.
        // If it's "none" or empty, user can type it.
        if (initialRefParam && initialRefParam !== "none") {
            setInviteCode(initialRefParam);
        }
    }, [initialRefParam]);

    const handleSubmit = () => {
        if (!agreed) {
            // Shake effect or alert
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
            }
            alert("Please agree to the Terms of Service.");
            return;
        }

        if (window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }
        
        // Pass the manually entered code (or the prefilled one) back to App
        onComplete(inviteCode);
    };

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 animate-fade-in relative overflow-hidden">
            {/* Background Decorations */}
            <div className="absolute top-0 left-0 w-64 h-64 bg-blue-600/20 rounded-full blur-[80px] -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
            <div className="absolute bottom-0 right-0 w-64 h-64 bg-purple-600/20 rounded-full blur-[80px] translate-x-1/2 translate-y-1/2 pointer-events-none"></div>

            <div className="z-10 w-full max-w-sm space-y-8">
                <div className="text-center space-y-2">
                    <div className="w-20 h-20 bg-gradient-to-tr from-blue-500 to-purple-600 rounded-2xl mx-auto flex items-center justify-center shadow-2xl mb-6 transform rotate-3">
                        <span className="text-4xl">💎</span>
                    </div>
                    <h1 className="text-3xl font-black text-white tracking-tight">NFT Genesis</h1>
                    <p className="text-gray-400">Join the exclusive ecosystem.</p>
                </div>

                <div className="space-y-4">
                    {/* Invite Code Input */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 uppercase ml-1">Invite Code</label>
                        <input 
                            type="text" 
                            value={inviteCode}
                            onChange={(e) => setInviteCode(e.target.value)}
                            placeholder="e.g. ref_12345"
                            className="w-full bg-gray-800/50 border border-gray-700 text-white p-4 rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all outline-none font-mono text-center tracking-widest"
                        />
                        <p className="text-[10px] text-gray-500 text-center">
                            {initialRefParam && initialRefParam !== "none" ? "Applied from link" : "Enter manually if you have one"}
                        </p>
                    </div>

                    {/* Terms Checkbox */}
                    <div className="bg-gray-800/30 p-4 rounded-xl border border-white/5 flex gap-3 items-start cursor-pointer hover:bg-gray-800/50 transition-colors" onClick={() => setAgreed(!agreed)}>
                        <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors ${agreed ? 'bg-green-500 border-green-500' : 'border-gray-600 bg-gray-900'}`}>
                            {agreed && <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                        </div>
                        <div className="text-sm text-gray-400 select-none">
                            I agree to the <span className="text-blue-400 underline">Terms of Service</span> and <span className="text-blue-400 underline">Privacy Policy</span>. I confirm I am not a resident of restricted jurisdictions.
                        </div>
                    </div>
                </div>

                <button 
                    onClick={handleSubmit}
                    className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all transform active:scale-95 ${
                        agreed 
                        ? 'bg-white text-black hover:bg-gray-100 shadow-white/10' 
                        : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    }`}
                >
                    Start & Register
                </button>
            </div>
        </div>
    );
};