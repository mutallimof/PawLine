/** Entry point: fonts, styles, service-worker registration, React root. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

// Self-hosted fonts (bundled + precached — no runtime Google Fonts request,
// so typography works offline and on slow connections).
// Noto Sans/Serif chosen deliberately: full Azerbaijani Latin coverage
// (ə Ə ğ ı İ ş ç ö ü) AND complete Turkish — the previous fonts were
// missing the schwa (ə/Ə lives outside the common latin-ext subset most
// fonts ship), which rendered Azerbaijani text visibly broken.
// Subset-precise imports (latin + latin-ext cover az/tr/en fully) keep the
// PWA precache small — the full multi-script packages tripled its size.
import '@fontsource/noto-serif/latin-600.css';
import '@fontsource/noto-serif/latin-700.css';
import '@fontsource/noto-serif/latin-ext-600.css';
import '@fontsource/noto-serif/latin-ext-700.css';
import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/latin-600.css';
import '@fontsource/noto-sans/latin-700.css';
import '@fontsource/noto-sans/latin-800.css';
import '@fontsource/noto-sans/latin-ext-400.css';
import '@fontsource/noto-sans/latin-ext-600.css';
import '@fontsource/noto-sans/latin-ext-700.css';
import '@fontsource/noto-sans/latin-ext-800.css';

import './styles/index.css';
import App from './App';
import { initErrorMonitoring } from './lib/monitoring';

// Error monitoring (Sentry) — only if VITE_SENTRY_DSN is configured.
initErrorMonitoring();

// Auto-update the service worker so users always run the latest version.
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
