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
import { fetchMyProfile } from '../lib/api';
import type { Profile } from '../lib/types';
import { getLocale, setLocale, SUPPORTED_LOCALES, type LocaleCode } from '../i18n';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  /** True only while the persisted session is being restored on startup. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
    role: 'user' | 'vet'
  ) => Promise<{ needsEmailConfirm: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const PROFILE_RETRIES = 4; // 1s, 2s, 4s, 8s backoff

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
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
      return;
    }

    let cancelled = false;

    const load = async (attempt: number) => {
      try {
        const p = await fetchMyProfile();
        if (cancelled) return;
        if (!p) throw new Error('profile row not found (yet)');
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
          // Loud, not silent: this state previously masqueraded as
          // "signed out" in parts of the UI.
          console.error('PawLine: failed to load profile after retries', e);
        }
      }
    };

    void load(0);
    return () => {
      cancelled = true;
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [userId]);

  // ── 3. Auth actions ───────────────────────────────────────────────────────
  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string, role: 'user' | 'vet') => {
      // display_name / role / locale are read by the handle_new_user trigger,
      // which creates the profiles row server-side. Passing the locale here
      // preserves a language chosen while browsing as a guest.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName, role, locale: getLocale() },
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

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    try {
      const p = await fetchMyProfile();
      if (p) setProfile(p);
    } catch {
      // Keep the last known profile; the retry effect covers cold loads.
    }
  }, [userId]);

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, signIn, signUp, signOut, refreshProfile }}
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
