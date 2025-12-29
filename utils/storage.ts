import { IStorage } from '@tonconnect/ui-react';

export class UserScopedStorage implements IStorage {
    /**
     * Generates a unique key based on the current Telegram User ID.
     * If user ID is not available (browser testing), defaults to 'guest'.
     */
    private getKey(key: string): string {
        const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'guest';
        return `nft_app_${userId}_${key}`;
    }

    async getItem(key: string): Promise<string | null> {
        return localStorage.getItem(this.getKey(key));
    }

    async setItem(key: string, value: string): Promise<void> {
        localStorage.setItem(this.getKey(key), value);
    }

    async removeItem(key: string): Promise<void> {
        localStorage.removeItem(this.getKey(key));
    }
}