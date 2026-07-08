/**
 * Password reset, step 2.
 *
 * The email from resetPasswordForEmail() links here. Supabase's
 * detectSessionInUrl exchanges the link's token for a temporary RECOVERY
 * session automatically on load, after which updateUser({ password })
 * sets the new password. If someone opens this page without a recovery
 * session (bookmark, expired link), we say so instead of failing silently.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PasswordField, useToast } from '../components/ui';
import { supabase } from '../lib/supabase';
import { t } from '../i18n';

export default function ResetPasswordPage() {
  const { user, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  // Give detectSessionInUrl a moment to process the recovery token.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const save = async () => {
    if (password.length < 6) {
      toast(t('auth.passwordTooShort'));
      return;
    }
    if (password !== confirm) {
      toast(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      setDone(true);
      window.setTimeout(() => navigate('/'), 1600);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '80dvh' }}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontSize: 48 }}>🔑</div>
        <h1 className="page-title">{t('auth.resetTitle')}</h1>
      </div>

      {done ? (
        <div className="banner banner--success">{t('auth.resetDone')}</div>
      ) : loading || (!user && !settled) ? (
        <div className="spinner" />
      ) : !user ? (
        <div className="banner banner--warn">{t('auth.resetExpired')}</div>
      ) : (
        <>
          <PasswordField
            label={t('auth.newPassword')}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <PasswordField
            label={t('auth.confirmPassword')}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            onEnter={() => void save()}
          />
          <button
            className="btn btn--primary"
            disabled={busy || !password || !confirm}
            onClick={() => void save()}
          >
            {t('auth.savePassword')}
          </button>
        </>
      )}
    </div>
  );
}
