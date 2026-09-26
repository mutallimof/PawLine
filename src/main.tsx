/** Entry point: fonts, styles, service-worker registration, React root. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

// Self-hosted font (bundled + precached — no runtime Google Fonts request,
// so typography works offline and on slow connections).
// DM Sans stands in for the design's Aeonik (commercial, not web-licensed)
// and is the only family — headings and body alike, as in the design.
// wght.css is the variable-weight build: one file per subset covers every
// weight the app uses. Both subsets load because Azerbaijani/Turkish split
// across them — ə Ə ğ İ ş live in latin-ext, ç ö ü ı in latin — verified
// at the glyph level (the schwa is what broke the fonts before Noto).
import '@fontsource-variable/dm-sans/wght.css';

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
