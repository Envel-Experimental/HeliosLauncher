import React, { createContext, useContext, useState } from 'react';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [currentView, setCurrentView] = useState('landing'); // landing, login, settings
  const [overlay, setOverlay] = useState(null); // { title, description, acknowledge, acknowledge_mid, dismiss }
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  const showOverlay = (options) => setOverlay(options);
  const hideOverlay = () => setOverlay(null);

  const showLoading = (text) => {
    setLoadingText(text);
    setLoading(true);
  };
  const hideLoading = () => setLoading(false);

  return (
    <AppContext.Provider
      value={{
        currentView,
        setCurrentView,
        overlay,
        showOverlay,
        hideOverlay,
        loading,
        loadingText,
        showLoading,
        hideLoading
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
