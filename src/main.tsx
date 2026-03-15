import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

console.log("Main entry point loading...");
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('SW registered:', registration);

      // Check for updates every time the page loads
      registration.update();

      // When a new SW is waiting, reload the page to activate it
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            // New SW activated — reload to get fresh assets
            console.log('New SW activated, reloading...');
            window.location.reload();
          }
        });
      });

    }).catch(err => {
      console.log('SW registration failed:', err);
    });

    // If the SW controlling this page changes, reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  });
}
