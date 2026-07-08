/**
 * Supabase client singleton.
 *
 * The anon key is public by design — every read/write is gated by Row Level
 * Security policies and SECURITY DEFINER functions defined in
 * supabase/migrations/001_init.sql.
 *
 * HMR NOTE: in dev, Vite hot-module-reload can re-evaluate this module and
 * create a second GoTrueClient fighting the first over the same localStorage
 * session (the "Multiple GoTrueClient instances detected" console warning —
 * a real source of inconsistent auth state, not just noise). We therefore
 * stash the client on globalThis in dev so every re-evaluation reuses the
 * exact same instance. In production the module is evaluated once anyway.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  // Fail loudly during development — a blank screen with a silent error is
  // the worst possible way to discover a missing .env file.
  // eslint-disable-next-line no-console
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.'
  );
}

function buildClient(): SupabaseClient {
  return createClient(url ?? '', anonKey ?? '', {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
  });
}

const globalStore = globalThis as unknown as { __pawline_supabase?: SupabaseClient };

export const supabase: SupabaseClient =
  globalStore.__pawline_supabase ?? buildClient();

if (import.meta.env.DEV) {
  globalStore.__pawline_supabase = supabase;
}
