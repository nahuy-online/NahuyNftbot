
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { translations, Language } from './translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('en');

  useEffect(() => {
    // Detect language from Telegram
    if (window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code) {
      const userLang = window.Telegram.WebApp.initDataUnsafe.user.language_code.toLowerCase();
      // If starts with 'ru' -> Russian, otherwise -> English
      if (userLang.startsWith('ru')) {
        setLanguage('ru');
      } else {
        setLanguage('en');
      }
    }
  }, []);

  const t = (key: string, params?: Record<string, string | number>): string => {
    let text = translations[language][key] || translations['en'][key] || key;
    
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    
    return text;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
};
