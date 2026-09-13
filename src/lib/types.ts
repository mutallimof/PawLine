/**
 * Shared types mirroring the database schema (supabase/migrations/001_init.sql).
 * If you change the schema, update these in the same commit.
 */

export type CaseStatus =
  | 'open'
  | 'accepted'
  | 'vet_selected'
  | 'vet_confirmed'
  | 'en_route'
  | 'resolved'
  | 'closed';

export type AnimalType = 'dog' | 'cat' | 'other';
export type ProfileRole = 'user' | 'vet';
export type NewCasePref = 'nearby' | 'all' | 'off';

export type NotificationType =
  | 'case_new_nearby'
  | 'case_accepted'
  | 'case_dropped'
  | 'vet_requested'
  | 'vet_confirmed'
  | 'vet_declined'
  | 'case_en_route'
  | 'case_resolved'
  | 'case_update'
  | 'case_message'
  | 'direct_message';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: ProfileRole;
  xp: number;
  cases_helped: number;
  partner_org?: string | null;
  /* Private fields below exist only on YOUR OWN profile (get_my_profile
     RPC); other users' directory entries omit them — see api.ts S1 note. */
  locale?: string;
  is_admin?: boolean;
  banned?: boolean;
  new_case_pref?: NewCasePref;
  home_lat?: number | null;
  home_lng?: number | null;
  notify_radius_km?: number;
  /** Migration 014 (C5) — additive, nullable; older rows have none of these. */
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  created_at: string;
}

export interface Vet {
  id: string;
  clinic_name: string;
  address: string;
  /** Public clinic contact — was `phone` before migration 014 (C3 rename). */
  contact_phone: string;
  contact_email: string;
  lat: number;
  lng: number;
  /**
   * CAPACITY switch, not opening hours: "we're open but can't take more right
   * now". Opening hours are the fields below — a clinic that forgets to flip
   * this at closing time is no longer recommended all night (migration 010).
   */
  is_open: boolean;
  /** Local wall-clock hours. null = not set yet (treated as open, not hidden). */
  opens_at: string | null;   // 'HH:MM:SS'
  closes_at: string | null;  // 'HH:MM:SS'
  /** Round-the-clock emergency clinic — hours are ignored entirely. */
  is_24_7: boolean;
  /** Hours are wall-clock, so they need a zone. Baku and Istanbul differ. */
  timezone: string;
  /** Animal types this clinic accepts (migration 014, C3). */
  accepted_animals: AnimalType[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  /** Computed server-side (view vets_public) — never trust a client clock. */
  open_now?: boolean;
  /** open_now AND has capacity. This is what the picker gates on. */
  accepting_now?: boolean;
  /** Computed server-side (vets_public) — 0 with no ratings yet. */
  rating_avg?: number;
  rating_count?: number;
  /**
   * PRIVATE — the clinic's internal contact person, not necessarily the
   * Supabase-auth account holder. Present only via get_my_vet() (own clinic)
   * or admin_list_pending_vets() (admin review); absent from vets_public.
   */
  manager_name?: string;
  manager_surname?: string;
  manager_phone?: string;
}

/** Migration 014 (C1) — a file the vet submitted toward verification. */
export interface VetDocument {
  id: string;
  vet_id: string;
  path: string;
  filename: string;
  created_at: string;
}

/** Migration 014 (C2) — a rescuer's rating of the vet on one resolved case. */
export interface VetRating {
  id: string;
  case_id: string;
  vet_id: string;
  rescuer_id: string;
  rating: number;
  note: string;
  created_at: string;
}

export interface RescueCase {
  id: string;
  reporter_id: string | null;
  guest_name: string | null;
  animal: AnimalType;
  description: string;
  lat: number;
  lng: number;
  address_hint: string;
  status: CaseStatus;
  rescuer_id: string | null;
  vet_id: string | null;
  rescuer_lat: number | null;
  rescuer_lng: number | null;
  rescuer_loc_at: string | null;
  hidden: boolean;
  escalated_at: string | null;
  closed_reason: 'community' | 'expired' | null;
  injury_type: InjuryType | null;
  spot_type: SpotType | null;
  urgency: UrgencyLevel;
  created_at: string;
  accepted_at: string | null;
  resolved_at: string | null;
}

export type InjuryType = 'limping' | 'bleeding' | 'hit_by_car' | 'weak' | 'skin' | 'trapped' | 'unknown';
export type SpotType = 'street' | 'park' | 'dumpster' | 'building' | 'courtyard' | 'roadside';
export const INJURY_TYPES: InjuryType[] = ['limping','bleeding','hit_by_car','weak','skin','trapped','unknown'];
export const SPOT_TYPES: SpotType[] = ['street','park','dumpster','building','courtyard','roadside'];

/** Migration 022 — purely descriptive, reporter-picked. Default 'medium'. */
export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';
export const URGENCY_LEVELS: UrgencyLevel[] = ['low', 'medium', 'high', 'critical'];

/** A case joined with the bits the UI always needs. */
export interface CaseWithDetails extends RescueCase {
  photos: CasePhoto[];
  reporter?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null;
  rescuer?: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'xp'> | null;
  vet?: Vet | null;
}

export interface CasePhoto {
  id: string;
  case_id: string;
  /** DB column (migration 018) — a bare storage path, never fetchable directly. */
  path: string;
  kind: 'report' | 'delivery';
  created_at: string;
  /**
   * NOT a DB column — hydrated client-side by fetchCases()/fetchCase() from
   * a batched createSignedUrls() call (case-photos is a private bucket as
   * of migration 018). Null if signing that path failed; render sites treat
   * that the same as "no photo".
   */
  url: string | null;
}

export interface CaseEvent {
  id: number;
  case_id: string;
  actor_id: string | null;
  type: NotificationType;
  note: string;
  created_at: string;
}

export interface AppNotification {
  id: number;
  profile_id: string;
  type: NotificationType;
  case_id: string | null;
  conversation_id: string | null;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  created_at: string;
}

export interface DirectMessage {
  id: number;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface CaseMessage {
  id: number;
  case_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender?: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'role'>;
}

/** Conversation summary for the Messages inbox. */
export interface InboxEntry {
  conversationId: string;
  other: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'role'>;
  lastMessage: DirectMessage | null;
  unread: boolean;
}

/**
 * A case chat summary for the Messages inbox (Group D) — one row per case
 * the user is attached to (reporter/rescuer/vet) or has posted in, that
 * actually has at least one message.
 *
 * Read state (migration 017): case_watchers.last_read_at, mirroring DMs'
 * conversation_participants.last_read_at. `unread` matches InboxEntry's
 * boolean; `unreadCount` is the number shown in the Messages list badge —
 * DMs don't have an equivalent count field, only the dot.
 */
export interface CaseChatInboxEntry {
  caseId: string;
  animal: AnimalType;
  addressHint: string;
  status: CaseStatus;
  lastMessage: CaseMessage | null;
  unread: boolean;
  unreadCount: number;
}


// ---------------------------------------------------------------------------
// Production-pass additions (migration 003)
// ---------------------------------------------------------------------------

export interface ContentReport {
  id: number;
  reporter_id: string;
  target_type: 'case' | 'case_message' | 'profile';
  target_case: string | null;
  target_message: number | null;
  target_profile: string | null;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
  // Denormalized previews of the reported content, joined in fetchOpenReports()
  // so the admin screen can show what's actually being reported (B3).
  reported_case?: Pick<RescueCase, 'id' | 'description' | 'animal' | 'hidden'> | null;
  reported_message?: { id: number; body: string; case_id: string; hidden: boolean } | null;
  reported_profile?: Pick<Profile, 'id' | 'display_name'> | null;
}

export interface DuplicateFlag {
  id: number;
  case_id: string;
  similar_case_id: string;
  distance_m: number;
  minutes_apart: number;
  phash_distance: number | null;
  status: 'pending' | 'confirmed' | 'dismissed';
  created_at: string;
}

export interface Sponsor {
  id: string;
  name: string;
  kind: 'sponsor' | 'partner';
  logo_url: string;
  url: string;
  blurb: string;
  active: boolean;
  sort: number;
  created_at: string;
}
