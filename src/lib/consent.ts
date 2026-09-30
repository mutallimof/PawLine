/**
 * Age (18+) and Terms/Privacy consent. The acceptance lives on the profile
 * (terms_accepted_at / terms_version, migration 034) and is written only by
 * the record_terms_acceptance() RPC.
 *
 * Bump TERMS_VERSION when the Terms or Privacy Policy change materially:
 * every account whose stored version differs is asked again (ConsentGate).
 */
import type { Profile } from './types';

export const TERMS_VERSION = '2026-09-30';

export function needsConsent(profile: Pick<Profile, 'terms_accepted_at' | 'terms_version'>): boolean {
  // Before migration 034 is applied, get_my_profile() has no such column at
  // all — don't gate then, or nobody could get past a consent screen whose
  // RPC doesn't exist yet. (Same "undefined until applied" posture as
  // pinned_message_id / chat_closed_at.)
  if (!('terms_accepted_at' in profile)) return false;
  return !profile.terms_accepted_at || profile.terms_version !== TERMS_VERSION;
}
