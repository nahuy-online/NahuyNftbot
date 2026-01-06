
interface Window {
  Telegram?: {
    WebApp: {
      ready: () => void;
      expand: () => void;
      enableClosingConfirmation: () => void;
      isVersionAtLeast: (version: string) => boolean;
      showAlert: (message: string) => void;
      openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
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
