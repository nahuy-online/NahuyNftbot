// This utility manages swapping TonConnect sessions for different Telegram users
// sharing the same browser/webview storage.

const STORAGE_KEYS_PREFIX = 'ton-connect'; // TonConnect uses keys starting with this
const LAST_USER_KEY = 'nft_app_active_user_id';

export const initSession = () => {
    try {
        // 1. Get Current Telegram User ID
        const initDataUnsafe = window.Telegram?.WebApp?.initDataUnsafe;
        const currentUserId = initDataUnsafe?.user?.id ? String(initDataUnsafe.user.id) : 'guest';
        
        // 2. Get Last Active User ID
        const lastUserId = localStorage.getItem(LAST_USER_KEY);

        // 3. If the user changed, swap the storage data
        if (lastUserId && lastUserId !== currentUserId) {
            console.log(`[SessionManager] Switching user from ${lastUserId} to ${currentUserId}`);
            swapStorageData(lastUserId, currentUserId);
        } else {
            console.log(`[SessionManager] Current user: ${currentUserId}`);
        }

        // 4. Update the active user tracker
        localStorage.setItem(LAST_USER_KEY, currentUserId);

    } catch (e) {
        console.error("[SessionManager] Failed to init session", e);
    }
};

const swapStorageData = (oldUserId: string, newUserId: string) => {
    // A. Backup keys for the Old User
    const allKeys = Object.keys(localStorage);
    allKeys.forEach(key => {
        if (key.startsWith(STORAGE_KEYS_PREFIX)) {
            const value = localStorage.getItem(key);
            if (value) {
                // Save to backup slot: "user_123_ton-connect-..."
                localStorage.setItem(`user_${oldUserId}_${key}`, value);
                // Remove from active slot
                localStorage.removeItem(key);
            }
        }
    });

    // B. Restore keys for the New User
    const newKeys = Object.keys(localStorage);
    newKeys.forEach(key => {
        const prefix = `user_${newUserId}_${STORAGE_KEYS_PREFIX}`;
        if (key.startsWith(prefix)) {
            const value = localStorage.getItem(key);
            const originalKey = key.replace(`user_${newUserId}_`, ''); // Restore original key name
            
            if (value) {
                localStorage.setItem(originalKey, value);
            }
        }
    });
};