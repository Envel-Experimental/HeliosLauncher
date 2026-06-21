import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './AppContext';
import App from './App';
import './ReactUI.css';

// Initialize React UI in the existing launcher
const initReactUI = () => {
  // Check if the container already exists
  let rootElement = document.getElementById('react-root');
  
  if (!rootElement) {
    // We only want React to overtake the landing container, not the whole body
    const landingContainer = document.getElementById('landingContainer');
    
    if (landingContainer) {
      // Hide all vanilla children in landingContainer but keep them in DOM for hacks (like launch_button)
      Array.from(landingContainer.children).forEach(child => {
        child.style.display = 'none';
      });
      
      // Create container for React
      rootElement = document.createElement('div');
      rootElement.id = 'react-root';
      rootElement.style.width = '100%';
      rootElement.style.height = '100%';
      rootElement.style.position = 'absolute';
      rootElement.style.top = '0';
      rootElement.style.left = '0';
      landingContainer.appendChild(rootElement);
    } else {
      console.error('[ReactUI] Could not find #landingContainer');
      return;
    }
  }

  const root = createRoot(rootElement);
  root.render(
    <AppProvider>
      <App />
    </AppProvider>
  );

  console.log('[ReactUI] Successfully mounted inside #landingContainer.');
};

// Start only after the DOM is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReactUI);
} else {
  initReactUI();
}

export { initReactUI };
