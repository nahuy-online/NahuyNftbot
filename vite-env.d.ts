interface Window {
  Telegram?: {
    WebApp: {
      ready: () => void;
      expand: () => void;
      enableClosingConfirmation: () => void;
      showAlert: (message: string) => void;
      openTelegramLink: (url: string) => void;
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
        auth_date?: number;
        hash?: string;
      };
    };
  };
}