/**
 * Data-access layer.
 *
 * Every Supabase query and RPC call the app makes lives here, so components
 * stay free of query details and the schema can evolve in one place.
 *
 * Note: case status is NEVER updated from the client with .update() —
 * all transitions go through the database state-machine RPCs.
 */
import { supabase } from './supabase';
import type {
  AppNotification,
  ContentReport,
  DuplicateFlag,
  Sponsor,
  CaseEvent,
  CaseMessage,
  CaseWithDetails,
  DirectMessage,
  InboxEntry,
  Profile,
  RescueCase,
  Vet,
} from './types';
import { uploadCasePhoto } from './photos';
import { computeDHash } from './phash';

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const CASE_SELECT = `
  *,
  photos:case_photos (*),
  reporter:profiles!cases_reporter_id_fkey (id, display_name, avatar_url),
  rescuer:profiles!cases_rescuer_id_fkey (id, display_name, avatar_url, xp),
  vet:vets!cases_vet_id_fkey (*)
`;

export async function fetchCases(): Promise<CaseWithDetails[]> {
  const { data, error } = await supabase
    .from('cases')
    .select(CASE_SELECT)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as CaseWithDetails[];
}

export async function fetchCase(id: string): Promise<CaseWithDetails | null> {
  const { data, error } = await supabase
    .from('cases')
    .select(CASE_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as CaseWithDetails | null;
}

export interface NewCaseInput {
  animal: RescueCase['animal'];
  description: string;
  lat: number;
  lng: number;
  addressHint: string;
  guestName: string | null;
  reporterId: string | null;
  injuryType: import('./types').InjuryType | null;
  spotType: import('./types').SpotType | null;
  photos: File[];
}

/**
 * Create a case (guest or registered) and upload its photos.
 * The insert itself triggers the "new case" notification fan-out.
 *
 * Guests get a transparent ANONYMOUS Supabase session first — the report
 * flow stays account-free for the person, but every device now has a
 * stable identity the database rate-limits against (migration 003).
 * Requires "Allow anonymous sign-ins" to be enabled in the Supabase
 * dashboard (Authentication → Sign In / Up).
 */
export async function createCase(input: NewCaseInput): Promise<string> {
  if (!input.reporterId) {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) {
      const { error: anonErr } = await supabase.auth.signInAnonymously();
      if (anonErr) throw new Error(anonErr.message);
    }
  }

  const { data, error } = await supabase
    .from('cases')
    .insert({
      animal: input.animal,
      description: input.description,
      lat: input.lat,
      lng: input.lng,
      address_hint: input.addressHint,
      injury_type: input.injuryType,
      spot_type: input.spotType,
      guest_name: input.guestName,
      reporter_id: input.reporterId,
    })
    .select('id')
    .single();
  if (error) throw error;

  const caseId = data.id as string;

  // Upload photos sequentially — mobile connections handle this better than
  // parallel uploads, and order is preserved for the gallery. Each photo
  // also gets a perceptual hash (computed on-device, milliseconds) so the
  // duplicate scan below can compare images.
  for (const file of input.photos) {
    // Bad-signal resilience (audit P1): each photo gets three attempts with
    // backoff before we declare the network dead.
    let url = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        url = await uploadCasePhoto(file, caseId);
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
    const phash = await computeDHash(file).catch(() => null);
    const { error: photoErr } = await supabase
      .from('case_photos')
      .insert({ case_id: caseId, url, kind: 'report', phash });
    if (photoErr) throw photoErr;
  }

  // Soft duplicate detection — advisory flags only, never blocks the report.
  await supabase.rpc('check_case_duplicates', { p_case: caseId }).then(
    () => {},
    () => {} // best effort; a failed scan must never fail the report
  );

  return caseId;
}

export async function fetchCaseEvents(caseId: string): Promise<CaseEvent[]> {
  const { data, error } = await supabase
    .from('case_events')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CaseEvent[];
}

// --- State machine RPCs (thin wrappers, errors bubble to the UI) -----------

/** Call an RPC and throw a readable Error if it failed. */
async function rpc(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
}

export const acceptCase = (caseId: string) => rpc('accept_case', { p_case: caseId });

export const dropCase = (caseId: string) => rpc('drop_case', { p_case: caseId });

export const selectVet = (caseId: string, vetId: string) =>
  rpc('select_vet', { p_case: caseId, p_vet: vetId });

export const vetRespond = (caseId: string, accept: boolean) =>
  rpc('vet_respond', { p_case: caseId, p_accept: accept });

export const startTransport = (caseId: string) => rpc('start_transport', { p_case: caseId });

export const confirmDelivery = (caseId: string) => rpc('confirm_delivery', { p_case: caseId });

export const vetPostUpdate = (caseId: string, note: string) =>
  rpc('vet_post_update', { p_case: caseId, p_note: note });

export const watchCase = (caseId: string) => rpc('watch_case', { p_case: caseId });

export const unwatchCase = (caseId: string) => rpc('unwatch_case', { p_case: caseId });

export const updateRescuerLocation = (caseId: string, lat: number, lng: number) =>
  rpc('update_rescuer_location', { p_case: caseId, p_lat: lat, p_lng: lng });

export async function isWatching(caseId: string, profileId: string): Promise<boolean> {
  const { data } = await supabase
    .from('case_watchers')
    .select('case_id')
    .eq('case_id', caseId)
    .eq('profile_id', profileId)
    .maybeSingle();
  return !!data;
}

export async function addDeliveryPhoto(caseId: string, file: File): Promise<void> {
  const url = await uploadCasePhoto(file, caseId);
  const { error } = await supabase
    .from('case_photos')
    .insert({ case_id: caseId, url, kind: 'delivery' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Vets
// ---------------------------------------------------------------------------

export async function fetchVets(): Promise<Vet[]> {
  const { data, error } = await supabase.from('vets').select('*');
  if (error) throw error;
  return (data ?? []) as Vet[];
}

export async function fetchVet(id: string): Promise<Vet | null> {
  const { data, error } = await supabase.from('vets').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Vet | null;
}

/** Clinic owners manage their details — verification status is admin-only. */
export async function upsertVet(vet: Omit<Vet, 'created_at' | 'status'>): Promise<void> {
  const { error } = await supabase.from('vets').upsert(vet);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * SECURITY (audit S1): profiles are a public DIRECTORY, not a public table.
 * Only these columns are readable by other users — home coordinates, alert
 * settings, locale, and admin/ban flags are NOT (column-level grants,
 * migration 005). Your own full row comes from the get_my_profile() RPC.
 */
export const PUBLIC_PROFILE_COLUMNS =
  'id, display_name, avatar_url, role, xp, cases_helped, created_at';

/** Another user's public directory entry (private fields absent). */
export async function fetchProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

/** The signed-in user's own FULL profile (RPC bypasses the column limits). */
export async function fetchMyProfile(): Promise<Profile | null> {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) throw new Error(error.message);
  return ((data as Profile[] | null)?.[0] ?? null);
}

export async function updateProfile(
  id: string,
  patch: Partial<
    Pick<Profile, 'display_name' | 'locale' | 'new_case_pref' | 'home_lat' | 'home_lng' | 'notify_radius_km'>
  >
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) throw error;
}

export async function searchProfiles(query: string, excludeId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PUBLIC_PROFILE_COLUMNS)
    .ilike('display_name', `%${query}%`)
    .neq('id', excludeId)
    .limit(20);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function fetchNotifications(profileId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function markNotificationRead(id: number): Promise<void> {
  await supabase.from('notifications').update({ read: true }).eq('id', id);
}

export async function markAllNotificationsRead(profileId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('profile_id', profileId)
    .eq('read', false);
}

// ---------------------------------------------------------------------------
// Chat system 1 — direct messages
// ---------------------------------------------------------------------------

export async function getOrCreateDm(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_dm', { p_other: otherId });
  if (error) throw error;
  return data as string;
}

export async function fetchInbox(myId: string): Promise<InboxEntry[]> {
  // 1. My conversation memberships (with read markers).
  const { data: mine, error } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('profile_id', myId);
  if (error) throw error;
  if (!mine || mine.length === 0) return [];

  const convIds = mine.map((m) => m.conversation_id);
  const lastReadByConv = new Map(mine.map((m) => [m.conversation_id, m.last_read_at]));

  // 2. The other participant of each conversation.
  const { data: others } = await supabase
    .from('conversation_participants')
    .select('conversation_id, profile:profiles (id, display_name, avatar_url, role)')
    .in('conversation_id', convIds)
    .neq('profile_id', myId);

  // 3. Recent messages across these conversations; reduce to latest-per-conv.
  const { data: msgs } = await supabase
    .from('messages')
    .select('*')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false })
    .limit(300);

  const latest = new Map<string, DirectMessage>();
  for (const m of (msgs ?? []) as DirectMessage[]) {
    if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, m);
  }

  const entries: InboxEntry[] = [];
  for (const row of others ?? []) {
    const other = row.profile as unknown as InboxEntry['other'];
    if (!other) continue;
    const last = latest.get(row.conversation_id) ?? null;
    const lastRead = lastReadByConv.get(row.conversation_id);
    entries.push({
      conversationId: row.conversation_id,
      other,
      lastMessage: last,
      unread: !!last && last.sender_id !== myId && !!lastRead && last.created_at > lastRead,
    });
  }

  // Newest activity first.
  entries.sort((a, b) =>
    (b.lastMessage?.created_at ?? '').localeCompare(a.lastMessage?.created_at ?? '')
  );
  return entries;
}

export async function fetchMessages(conversationId: string): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as DirectMessage[];
}

export async function sendMessage(conversationId: string, senderId: string, body: string) {
  const { error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, body });
  if (error) throw error;
}

export const markConversationRead = (conversationId: string) =>
  rpc('mark_conversation_read', { p_conv: conversationId });

export async function fetchDmPartner(
  conversationId: string,
  myId: string
): Promise<InboxEntry['other'] | null> {
  const { data } = await supabase
    .from('conversation_participants')
    .select('profile:profiles (id, display_name, avatar_url, role)')
    .eq('conversation_id', conversationId)
    .neq('profile_id', myId)
    .maybeSingle();
  return (data?.profile as unknown as InboxEntry['other']) ?? null;
}

// ---------------------------------------------------------------------------
// Chat system 2 — per-case group chat
// ---------------------------------------------------------------------------

export async function fetchCaseMessages(caseId: string): Promise<CaseMessage[]> {
  const { data, error } = await supabase
    .from('case_messages')
    .select('*, sender:profiles (id, display_name, avatar_url, role)')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as CaseMessage[];
}

export async function sendCaseMessage(caseId: string, senderId: string, body: string) {
  const { error } = await supabase
    .from('case_messages')
    .insert({ case_id: caseId, sender_id: senderId, body });
  if (error) throw error;
}



// ---------------------------------------------------------------------------
// Moderation (users file reports; admins act — migration 003)
// ---------------------------------------------------------------------------

export async function reportContent(input: {
  reporterId: string;
  targetType: 'case' | 'case_message' | 'profile';
  targetCase?: string;
  targetMessage?: number;
  targetProfile?: string;
  reason: string;
}): Promise<void> {
  const { error } = await supabase.from('content_reports').insert({
    reporter_id: input.reporterId,
    target_type: input.targetType,
    target_case: input.targetCase ?? null,
    target_message: input.targetMessage ?? null,
    target_profile: input.targetProfile ?? null,
    reason: input.reason,
  });
  if (error) throw new Error(error.message);
}

export async function fetchOpenReports(): Promise<ContentReport[]> {
  const { data, error } = await supabase
    .from('content_reports')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as ContentReport[];
}

export const adminHideCase = (caseId: string, hidden: boolean) =>
  rpc('admin_hide_case', { p_case: caseId, p_hidden: hidden });
export const adminHideCaseMessage = (id: number, hidden: boolean) =>
  rpc('admin_hide_case_message', { p_id: id, p_hidden: hidden });
export const adminBanUser = (profileId: string, banned: boolean) =>
  rpc('admin_ban_user', { p_profile: profileId, p_banned: banned });
export const adminResolveReport = (id: number, status: 'resolved' | 'dismissed') =>
  rpc('admin_resolve_report', { p_id: id, p_status: status });

// ---------------------------------------------------------------------------
// Vet verification (admin)
// ---------------------------------------------------------------------------

export async function fetchPendingVets(): Promise<Vet[]> {
  const { data, error } = await supabase
    .from('vets')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Vet[];
}

export const adminSetVetStatus = (vetId: string, status: 'approved' | 'rejected' | 'pending') =>
  rpc('admin_set_vet_status', { p_vet: vetId, p_status: status });

// ---------------------------------------------------------------------------
// Duplicate flags
// ---------------------------------------------------------------------------

export async function fetchDuplicateFlags(caseId: string): Promise<DuplicateFlag[]> {
  const { data, error } = await supabase
    .from('case_duplicate_flags')
    .select('*')
    .eq('case_id', caseId)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  return (data ?? []) as DuplicateFlag[];
}

export const resolveDuplicateFlag = (id: number, confirm: boolean) =>
  rpc('resolve_duplicate_flag', { p_id: id, p_confirm: confirm });

// ---------------------------------------------------------------------------
// Sponsors / partners
// ---------------------------------------------------------------------------

export async function fetchSponsors(): Promise<Sponsor[]> {
  const { data, error } = await supabase
    .from('sponsors')
    .select('*')
    .order('sort', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Sponsor[];
}

export async function adminUpsertSponsor(sponsor: Partial<Sponsor> & { name: string }): Promise<void> {
  const { error } = await supabase.from('sponsors').upsert(sponsor);
  if (error) throw new Error(error.message);
}

export async function adminDeleteSponsor(id: string): Promise<void> {
  const { error } = await supabase.from('sponsors').delete().eq('id', id);
  if (error) throw new Error(error.message);
}


// ---------------------------------------------------------------------------
// Metrics & partners (migration 006)
// ---------------------------------------------------------------------------

export interface AdminStats {
  cases_total: number;
  cases_open_now: number;
  cases_resolved_30d: number;
  median_accept_min: number | null;
  median_resolve_min: number | null;
  active_rescuers_30d: number;
  reports_by_guests_7d: number;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const { data, error } = await supabase.rpc('admin_get_stats');
  if (error) throw new Error(error.message);
  return (data as AdminStats[])[0];
}

export interface PublicImpact {
  helped_this_month: number;
  helped_total: number;
  median_accept_min: number | null;
  rescuers_30d: number;
  clinics: number;
}

export async function fetchPublicImpact(): Promise<PublicImpact> {
  const { data, error } = await supabase.rpc('get_public_impact');
  if (error) throw new Error(error.message);
  return (data as PublicImpact[])[0];
}

export const adminSetPartner = (profileId: string, org: string | null) =>
  rpc('admin_set_partner', { p_profile: profileId, p_org: org });

// ---------------------------------------------------------------------------
// Pre-launch pass (migration 007): blocks, export, community flag, safety ack
// ---------------------------------------------------------------------------

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from('blocked_users')
    .insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) throw new Error(error.message);
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  if (error) throw new Error(error.message);
}

export async function fetchBlockedIds(blockerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('blocked_users')
    .select('blocked_id')
    .eq('blocker_id', blockerId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { blocked_id: string }).blocked_id);
}

/** "Animal not here / already helped" — returns the running distinct count. */
export async function flagNotHere(caseId: string): Promise<number> {
  const { data, error } = await supabase.rpc('flag_not_here', { p_case: caseId });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export async function acknowledgeSafety(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ safety_ack_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

/** Full self-serve data export (GDPR-shaped) as a JSON object. */
export async function exportMyData(): Promise<unknown> {
  const { data, error } = await supabase.rpc('export_my_data');
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Delete the caller's account. Supabase has no client-side user-delete, so
 * this scrubs profile data and signs out; auth-row removal is completed by
 * the operator (documented) or a scheduled cleanup. Cases anonymize via
 * ON DELETE SET NULL / the profile scrub, matching the privacy policy.
 */
export async function deleteMyAccount(userId: string): Promise<void> {
  // Remove personal + relational data the user owns. Cases stay (reporter_id
  // set null keeps rescue history without identity).
  await supabase.from('push_subscriptions').delete().eq('profile_id', userId);
  await supabase.from('blocked_users').delete().eq('blocker_id', userId);
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: 'Deleted user', avatar_url: null, home_lat: null, home_lng: null })
    .eq('id', userId);
  if (error) throw new Error(error.message);
  await supabase.auth.signOut();
}
