/** Sign in / create account. Vet clinics use the same flow with a toggle. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher, PasswordField, useToast } from '../components/ui';
import { IconGoogle, PawHeartMark } from '../components/Icons';
import { supabase } from '../lib/supabase';
import { t } from '../i18n';
import { ConsentChecks } from '../components/legal';
import { recordTermsAcceptance } from '../lib/api';
import { TERMS_VERSION } from '../lib/consent';
import { captchaOptions } from '../lib/turnstile';

// Set right when a vet signs up, consumed on whichever sign-in actually
// starts their session next — immediately below if email confirmation is
// off, or after they confirm their email and come back to sign in by hand
// (the common case in production). Keyed by email, not just "a vet is
// pending", so a different account signing in on the same browser first
// doesn't get redirected by mistake.
const VET_SETUP_PENDING_KEY = 'pawline-vet-setup-pending-email';

export default function AuthPage() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [isVet, setIsVet] = useState(false);
  // 034: both required to create an account (sign-up mode only).
  const [ageOk, setAgeOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const consentOk = ageOk && termsOk;
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
        ...(await captchaOptions()),
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
        const pendingVetEmail = localStorage.getItem(VET_SETUP_PENDING_KEY);
        if (pendingVetEmail && pendingVetEmail === email.trim().toLowerCase()) {
          localStorage.removeItem(VET_SETUP_PENDING_KEY);
          navigate('/vet-setup');
        } else {
          navigate('/');
        }
      } else {
        if (!consentOk) return;
        if (isVet) localStorage.setItem(VET_SETUP_PENDING_KEY, email.trim().toLowerCase());
        const { needsEmailConfirm } = await signUp(
          email.trim(),
          password,
          firstName.trim(),
          lastName.trim(),
          phone.trim(),
          isVet ? 'vet' : 'user'
        );
        if (needsEmailConfirm) {
          // No session yet: the consent travels in the sign-up metadata and
          // is recorded on first sign-in (ConsentGate).
          setInfo(t('auth.checkEmail'));
        } else {
          // Session exists — record the acceptance server-side now. If this
          // fails, ConsentGate asks again before the app is usable.
          await recordTermsAcceptance(TERMS_VERSION).catch(() => {});
          // Session created immediately (email confirmation disabled) —
          // send new vets straight to clinic setup.
          if (isVet) localStorage.removeItem(VET_SETUP_PENDING_KEY);
          navigate(isVet ? '/vet-setup' : '/');
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  // Same button, same handler, for both sign-in and sign-up — Supabase
  // resolves "new account or existing" transparently for OAuth. The vet
  // toggle only renders (and only means anything) in signup mode, exactly
  // like the email path below, whose role selection only ever happens
  // inside signUp(), never signIn() — so wantsVet is false in sign-in mode
  // even if isVet is stale-true from an earlier, abandoned toggle. This
  // redirects the whole page to Google; it only returns if that redirect
  // itself failed to start.
  const continueWithGoogle = async () => {
    setBusy(true);
    try {
      await signInWithGoogle(mode === 'signup' && isVet);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
      setBusy(false);
    }
  };

  return (
    <div className="page auth-page">
      {/* Group H: not gated behind signing in — every auth screen gets it.
          Kept outside the card and unstyled by the redesign below — the
          Figma reference omits it, but it stays (explicit instruction). */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <LanguageSwitcher />
      </div>

      <div className="auth-card">
        <div className="auth-card__brand">
          <div className="auth-card__logo" aria-hidden="true">
            <PawHeartMark />
          </div>
          <span className="auth-card__wordmark">{t('app.name')}</span>
        </div>
        <p className="auth-card__tagline">{t('app.tagline')}</p>

        {info && <div className="banner banner--success">{info}</div>}

        {mode === 'signup' && (
          <span className="field__label">{t('auth.roleLabel')}</span>
        )}
        {mode === 'signup' && (
          <div className="segmented auth-card__tabs" role="group" aria-label={t('auth.clinicToggle')}>
            <button
              type="button"
              className={`segmented__option${!isVet ? ' active' : ''}`}
              onClick={() => setIsVet(false)}
            >
              {t('auth.roleCommunity')}
            </button>
            <button
              type="button"
              className={`segmented__option${isVet ? ' active' : ''}`}
              onClick={() => setIsVet(true)}
            >
              {t('auth.roleVet')}
            </button>
          </div>
        )}

        {mode === 'signup' && (
          <>
            <div className="auth-card__row">
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
            className="link-btn auth-card__forgot"
            onClick={() => void forgotPassword()}
            disabled={busy}
          >
            {t('auth.forgot')}
          </button>
        )}

        {mode === 'signup' && (
          <ConsentChecks age={ageOk} terms={termsOk} onAge={setAgeOk} onTerms={setTermsOk} />
        )}

        <button
          className="btn btn--primary auth-card__cta"
          onClick={() => void submit()}
          disabled={busy || !email || !password || (mode === 'signup' && !consentOk)}
        >
          {mode === 'signin' ? t('auth.signIn') : t('auth.signUp')}
        </button>

        <div className="auth-card__divider">
          <span>{t('auth.orDivider')}</span>
        </div>

        <button
          type="button"
          className="btn btn--ghost auth-card__google"
          onClick={() => void continueWithGoogle()}
          disabled={busy}
        >
          <IconGoogle size={18} />
          {t('auth.continueWithGoogle')}
        </button>


        <button
          type="button"
          className="link-btn auth-card__switch"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}
        </button>

        <Link to="/" className="auth-card__guest">
          {t('auth.guestBrowse')}
        </Link>
        <Link to="/privacy" className="auth-card__legal">
          {t('privacy.link')}
        </Link>
      </div>
    </div>
  );
}
