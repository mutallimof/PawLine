/**
 * App shell — routing + global chrome.
 *
 * Chat threads render without the bottom nav (the composer takes its place);
 * everything else gets the four-tab bar with the raised Report button.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useNotifications } from './hooks/useRealtime';
import { BottomNav, SideNav, ToastProvider } from './components/ui';
import { getLocale, subscribeLocale, t } from './i18n';

import HomePage from './pages/HomePage';
import ReportPage from './pages/ReportPage';
import CaseDetailPage from './pages/CaseDetailPage';
import VetPickerPage from './pages/VetPickerPage';
import CaseChatPage from './pages/CaseChatPage';
import MessagesPage from './pages/MessagesPage';
import DmThreadPage from './pages/DmThreadPage';
import NotificationsPage from './pages/NotificationsPage';
import AuthPage from './pages/AuthPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VetsPage from './pages/VetsPage';
import AdminPage from './pages/AdminPage';
import { PrivacyPage } from './components/extras';
import ProfilePage from './pages/ProfilePage';
import {
  UserProfilePage,
  VetDashboardPage,
  VetPublicPage,
  VetSetupPage,
} from './pages/vetAndUserPages';

function Shell() {
  const { user, loading } = useAuth();
  const { unread } = useNotifications(user?.id);
  const location = useLocation();
  const [online, setOnline] = useState(navigator.onLine);
  // Re-render the whole tree when the language changes so every t() call
  // re-evaluates. Also keep <html lang> in sync for accessibility.
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontSize: 44 }}>
        🐾
      </div>
    );
  }

  // Full-screen chat routes replace the tab bar with their composer.
  const hideNav =
    /^\/messages\/.+/.test(location.pathname) || /\/chat$/.test(location.pathname);

  return (
    <div className="app-frame">
      {/* Desktop-only sidebar; phones keep the bottom tab bar (CSS-gated). */}
      <SideNav unreadAlerts={unread} />
      <div className="app-main">
        {!online && (
          <div className="banner banner--warn" style={{ borderRadius: 0, margin: 0, textAlign: 'center' }}>
            {t('common.offline')}
          </div>
        )}
        <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/case/:id" element={<CaseDetailPage />} />
        <Route path="/case/:id/vets" element={<VetPickerPage />} />
        <Route path="/case/:id/chat" element={<CaseChatPage />} />
        <Route path="/vets" element={<VetsPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:id" element={<DmThreadPage />} />
        <Route path="/alerts" element={<NotificationsPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/user/:id" element={<UserProfilePage />} />
        <Route path="/vet/:id" element={<VetPublicPage />} />
        <Route path="/vet-setup" element={<VetSetupPage />} />
        <Route path="/vet-dashboard" element={<VetDashboardPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
        {!hideNav && <BottomNav unreadAlerts={unread} />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
