/** Entry point: fonts, styles, service-worker registration, React root. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

// Tokens first: they declare the self-hosted fonts (Geologica for headings,
// Onest for body — Latin, Latin-ext and Cyrillic subsets only, bundled and
// precached, so type works offline) and every colour/shape/type token the
// stylesheets below read.
import './styles/tokens.css';
import './styles/index.css';
import './styles/app.css';
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
