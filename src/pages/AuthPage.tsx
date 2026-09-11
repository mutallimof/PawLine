/** Sign in / create account. Vet clinics use the same flow with a toggle. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PasswordField, useToast } from '../components/ui';
import { supabase } from '../lib/supabase';
import { t } from '../i18n';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [isVet, setIsVet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  /**
   * Password reset, step 1: Supabase emails a magic link that lands on
   * /reset-password (see ResetPasswordPage) with a recovery session.
   */
  const forgotPassword = async () => {
    if (!email.trim()) {
      toast(t('auth.forgotNeedEmail'));
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw new Error(error.message);
      setInfo(t('auth.resetSent'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setInfo(null);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        navigate('/');
      } else {
        const { needsEmailConfirm } = await signUp(
          email.trim(),
          password,
          firstName.trim(),
          lastName.trim(),
          phone.trim(),
          isVet ? 'vet' : 'user'
        );
        if (needsEmailConfirm) {
          setInfo(t('auth.checkEmail'));
        } else {
          // Session created immediately (email confirmation disabled) —
          // send new vets straight to clinic setup.
          navigate(isVet ? '/vet-setup' : '/');
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '90dvh' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 52 }}>🐾</div>
        <h1 className="page-title">{t('app.name')}</h1>
        <p className="page-subtitle">{t('app.tagline')}</p>
      </div>

      {info && <div className="banner banner--success">{info}</div>}

      {mode === 'signup' && (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span className="field__label">{t('auth.firstName')}</span>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={60}
                autoComplete="given-name"
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span className="field__label">{t('auth.lastName')}</span>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={60}
                autoComplete="family-name"
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">{t('auth.phone')}</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              inputMode="tel"
              autoComplete="tel"
            />
          </label>
          {/* Vets name their clinic separately, right after signup, in Vet
              Setup — this screen is only ever about the person signing up. */}
        </>
      )}

      <label className="field">
        <span className="field__label">{t('auth.email')}</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>

      <PasswordField
        label={t('auth.password')}
        value={password}
        onChange={setPassword}
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        onEnter={() => void submit()}
      />

      {mode === 'signin' && (
        <button
          type="button"
          className="link-btn"
          style={{ alignSelf: 'flex-end', marginTop: -8, marginBottom: 12 }}
          onClick={() => void forgotPassword()}
          disabled={busy}
        >
          {t('auth.forgot')}
        </button>
      )}

      {mode === 'signup' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontWeight: 700, fontSize: 14 }}>
          <input type="checkbox" checked={isVet} onChange={(e) => setIsVet(e.target.checked)} style={{ width: 18, height: 18 }} />
          {t('auth.clinicToggle')}
        </label>
      )}

      <button className="btn btn--primary" onClick={() => void submit()} disabled={busy || !email || !password}>
        {mode === 'signin' ? t('auth.signIn') : t('auth.signUp')}
      </button>

      <button
        className="btn btn--ghost"
        style={{ marginTop: 10 }}
        onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
      >
        {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}
      </button>

      <Link to="/" style={{ textAlign: 'center', marginTop: 18, color: 'var(--ink-soft)', fontWeight: 700, fontSize: 14 }}>
        {t('auth.guestBrowse')}
      </Link>
      <Link to="/privacy" style={{ textAlign: 'center', marginTop: 10, color: 'var(--ink-soft)', fontWeight: 700, fontSize: 12.5 }}>
        {t('privacy.link')}
      </Link>
    </div>
  );
}
