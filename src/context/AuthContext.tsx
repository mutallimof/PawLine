/**
 * Authentication context.
 *
 * Exposes the Supabase session plus the matching `profiles` row (display
 * name, role, XP, notification preferences, locale). Guests are fully
 * supported: `user` and `profile` are simply null.
 *
 * ── IMPORTANT: why this file is structured the way it is ────────────────────
 * A previous version awaited a database query (fetchProfile) INSIDE the
 * `onAuthStateChange` callback. That is a documented supabase-js v2 deadlock:
 * the client holds an internal auth lock while change callbacks run, and any
 * nested Supabase call needs the access token → calls getSession() → tries
 * to acquire the same lock → hangs. Depending on timing this left the app
 * with `user` null or `profile` null forever, so pages showed "please sign
 * in" to an authenticated user — even after refresh.
 *
 * The rules encoded below:
 *   1. The onAuthStateChange callback is 100% SYNCHRONOUS — it only writes
 *      React state. Never await Supabase calls inside it.
 *   2. Profile loading lives in a separate effect keyed on the user id,
 *      with exponential-backoff retries — a transient fetch failure can no
 *      longer strand the app in a "user set, profile null forever" state.
 *   3. `loading` refers only to session restoration. Pages must gate auth
 *      checks on `user`, never on `profile` (which may lag briefly).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { becomeVet, fetchMyProfile } from '../lib/api';
import { captureError } from '../lib/monitoring';
import type { Profile } from '../lib/types';
import { getLocale, setLocale, SUPPORTED_LOCALES, type LocaleCode } from '../i18n';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  /**
   * Set only once every retry in the profile-load effect below has been
   * exhausted — a signed-in user whose `profiles` row genuinely can't be
   * fetched, not a normal in-flight state. Pages should show this instead
   * of spinning forever once it's non-null.
   */
  profileError: string | null;
  /** Re-run the profile-load effect from attempt 0, clearing profileError first. */
  retryProfile: () => void;
  /** True only while the persisted session is being restored on startup. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    phone: string,
    role: 'user' | 'vet'
  ) => Promise<{ needsEmailConfirm: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /**
   * Full-page redirect to Google; resolves before navigation only if it
   * fails to start. `wantsVet` persists the signup toggle's choice across
   * the redirect (OAuth carries no role metadata of our own) — the profile
   * effect below consumes it once the Google session lands and calls the
   * same become_vet() RPC the Profile page's "Register your clinic" button
   * uses. Pass false for sign-in, or when the toggle is on Community.
   */
  signInWithGoogle: (wantsVet: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const PROFILE_RETRIES = 4; // 1s, 2s, 4s, 8s backoff

// Set right before a Google redirect chosen with the signup toggle on
// "Veterinary clinic"; consumed by the profile-loading effect below the
// moment a Google-authenticated session lands, then always cleared —
// whatever sign-in happens next (even an abandoned Google attempt followed
// by an unrelated email sign-in in the same browser) never acts on a stale
// flag, since it's gone after the very next profile load either way.
const OAUTH_VET_PENDING_KEY = 'pawline-oauth-vet-pending';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Bumping this re-runs the profile-load effect below from attempt 0 —
  // retryProfile()'s whole mechanism.
  const [profileRetryNonce, setProfileRetryNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const retryTimer = useRef<number | null>(null);

  // ── 1. Session wiring — synchronous callbacks only (see header note) ─────
  useEffect(() => {
    let mounted = true;

    // Restore the persisted session once. getSession() reads localStorage
    // and refreshes an expired token if needed (autoRefreshToken).
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    // Track every subsequent change (sign in/out, token refresh, other tab).
    // This callback must never await Supabase calls — deadlock risk.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ── 2. Profile loading — separate effect, outside the auth lock ──────────
  const userId = user?.id ?? null;
  useEffect(() => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    let cancelled = false;
    setProfileError(null); // clear any previous failure — this is a fresh attempt

    const load = async (attempt: number) => {
      try {
        let p = await fetchMyProfile();
        if (cancelled) return;
        if (!p) throw new Error('profile row not found (yet)');

        // Consume the pending-vet flag on the very first profile load after
        // ANY sign-in, not just Google's — clearing it here (regardless of
        // whether it actually applies) is what makes an abandoned Google
        // attempt followed by an unrelated email sign-in safe: the flag is
        // gone before it could be misread as "this account wants to be a
        // vet". Only acted on when this session is actually Google's,
        // confirmed via app_metadata.provider — never inferred from the
        // flag's mere presence.
        let pendingVet = false;
        try {
          pendingVet = localStorage.getItem(OAUTH_VET_PENDING_KEY) === '1';
          if (pendingVet) localStorage.removeItem(OAUTH_VET_PENDING_KEY);
        } catch {
          /* storage blocked — no pending-vet flag to honor either way */
        }
        if (pendingVet && p.role !== 'vet' && user?.app_metadata?.provider === 'google') {
          await becomeVet();
          const refetched = await fetchMyProfile();
          if (cancelled) return;
          if (refetched) p = refetched;
        }

        setProfile(p);
        // The profile's saved locale is authoritative once signed in.
        if (p.locale && p.locale in SUPPORTED_LOCALES) {
          setLocale(p.locale as LocaleCode);
        }
      } catch (e) {
        if (cancelled) return;
        if (attempt < PROFILE_RETRIES) {
          // Transient failure (network blip, or the handle_new_user trigger
          // racing right after signup) — retry with exponential backoff
          // instead of silently leaving profile null forever.
          retryTimer.current = window.setTimeout(
            () => void load(attempt + 1),
            1000 * 2 ** attempt
          );
        } else {
          // Loud, not silent: this state previously masqueraded as an
          // infinite spinner, invisible everywhere but a devtools console
          // nobody was watching — now it reaches Sentry AND the page (via
          // profileError) so pages can show something other than "loading"
          // forever.
          console.error('PawLine: failed to load profile after retries', e);
          captureError(e);
          setProfileError(e instanceof Error ? e.message : String(e));
        }
      }
    };

    void load(0);
    return () => {
      cancelled = true;
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [userId, profileRetryNonce]);

  // ── 3. Auth actions ───────────────────────────────────────────────────────
  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      firstName: string,
      lastName: string,
      phone: string,
      role: 'user' | 'vet'
    ) => {
      // first_name / last_name / phone / role / locale are read by the
      // handle_new_user trigger (migration 014), which creates the profiles
      // row server-side and computes display_name from first+last. Passing
      // the locale here preserves a language chosen while browsing as a guest.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            phone: phone || undefined,
            role,
            locale: getLocale(),
          },
        },
      });
      if (error) throw new Error(error.message);
      return { needsEmailConfirm: !data.session };
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  // handle_new_user (014/024) always sets role='user' for a fresh Google
  // identity — OAuth metadata has no 'role' key the way the email signup
  // form's payload does. wantsVet persists the signup toggle's choice
  // across the redirect via OAUTH_VET_PENDING_KEY; the profile-loading
  // effect above calls become_vet() once the Google session actually
  // lands, so the account is role='vet' by the time anything reads
  // `profile`. detectSessionInUrl (supabase.ts) + the onAuthStateChange
  // listener above pick up the session itself; no separate callback route
  // needed either way.
  const signInWithGoogle = useCallback(async (wantsVet: boolean) => {
    try {
      if (wantsVet) localStorage.setItem(OAUTH_VET_PENDING_KEY, '1');
      else localStorage.removeItem(OAUTH_VET_PENDING_KEY);
    } catch {
      /* storage blocked — become_vet() simply won't be called on return */
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) throw new Error(error.message);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    try {
      const p = await fetchMyProfile();
      if (p) setProfile(p);
    } catch {
      // Keep the last known profile; the retry effect covers cold loads.
    }
  }, [userId]);

  const retryProfile = useCallback(() => {
    setProfileError(null);
    setProfileRetryNonce((n) => n + 1);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        profileError,
        retryProfile,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        signInWithGoogle,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
