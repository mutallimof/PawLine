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
  created_at: string;
}

export interface Vet {
  id: string;
  clinic_name: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  is_open: boolean;
  status: 'pending' | 'approved' | 'rejected';
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
  created_at: string;
  accepted_at: string | null;
  resolved_at: string | null;
}

export type InjuryType = 'limping' | 'bleeding' | 'hit_by_car' | 'weak' | 'skin' | 'trapped' | 'unknown';
export type SpotType = 'street' | 'park' | 'dumpster' | 'building' | 'courtyard' | 'roadside';
export const INJURY_TYPES: InjuryType[] = ['limping','bleeding','hit_by_car','weak','skin','trapped','unknown'];
export const SPOT_TYPES: SpotType[] = ['street','park','dumpster','building','courtyard','roadside'];

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
  url: string;
  kind: 'report' | 'delivery';
  created_at: string;
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
