export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        version: string;
        isVersionAtLeast: (version: string) => boolean;
        ready: () => void;
        expand: () => void;
        enableClosingConfirmation: () => void;
        showAlert: (message: string) => void;
        showPopup: (params: {
            title?: string;
            message: string;
            buttons?: { id: string; type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive'; text?: string }[];
        }, callback?: (buttonId: string) => void) => void;
        close: () => void;
        openTelegramLink: (url: string) => void;
        openInvoice: (url: string, callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void) => void;
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
          query_id?: string;
          start_param?: string;
          auth_date?: number;
          hash?: string;
        };
      };
    };
  }
}