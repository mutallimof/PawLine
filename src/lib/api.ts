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
  CaseChatInboxEntry,
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
  VetDocument,
  VetRating,
} from './types';
import { uploadCasePhoto } from './photos';
import { computeDHash } from './phash';
import { getTurnstileToken, turnstileEnabled } from './turnstile';

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

// vet embed: an explicit column list, not '*'. Postgres expands an
// unqualified '*' to every column at parse time and requires SELECT on
// ALL of them — migration 014 narrowed vets' grant to this exact public
// list (dropping manager_name/manager_surname/manager_phone), so '*' here
// made the whole cases query fail with a permission error for anon/
// authenticated, i.e. the entire live feed. Keep this in sync with
// migration 014's `grant select (...) on public.vets` column list.
const CASE_SELECT = `
  *,
  photos:case_photos (*),
  reporter:profiles!cases_reporter_id_fkey (id, display_name, avatar_url),
  rescuer:profiles!cases_rescuer_id_fkey (id, display_name, avatar_url, xp),
  vet:vets!cases_vet_id_fkey (
    id, clinic_name, contact_phone, contact_email, address, lat, lng,
    is_open, opens_at, closes_at, is_24_7, timezone, accepted_animals,
    status, created_at
  )
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
      // Optional bot protection: attach a Turnstile token if configured.
      // If Turnstile is on but fails, we surface a clear error rather than
      // silently letting a bot through.
      let captchaToken: string | undefined;
      if (turnstileEnabled()) {
        const tok = await getTurnstileToken().catch(() => {
          throw new Error('captcha-failed');
        });
        captchaToken = tok ?? undefined;
      }
      const { error: anonErr } = await supabase.auth.signInAnonymously(
        captchaToken ? { options: { captchaToken } } : undefined
      );
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

/**
 * Reads the `vets_public` VIEW, not the table: it adds `open_now` and
 * `accepting_now`, computed from the clinic's real hours in ITS OWN timezone,
 * on the server. Computing openness on the device would be wrong the moment a
 * phone's clock or timezone is off — and a rescuer standing at a locked door
 * at 2am is exactly the failure this must never produce.
 */
export async function fetchVets(): Promise<Vet[]> {
  const { data, error } = await supabase.from('vets_public').select('*');
  if (error) throw error;
  return (data ?? []) as Vet[];
}

/** How many APPROVED clinics are actually open right now near a point. */
export async function openVetsNear(lat: number, lng: number, km = 25): Promise<number> {
  const { data, error } = await supabase.rpc('open_vets_near', {
    p_lat: lat,
    p_lng: lng,
    p_km: km,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export async function fetchVet(id: string): Promise<Vet | null> {
  const { data, error } = await supabase.from('vets_public').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Vet | null;
}

/**
 * The signed-in vet's OWN full clinic row, including the private manager_*
 * fields and contact_email — vets_public (public column list only, migration
 * 014) can't return those. Mirrors fetchMyProfile()/get_my_profile().
 */
export async function fetchMyVet(): Promise<Vet | null> {
  const { data, error } = await supabase.rpc('get_my_vet');
  if (error) throw new Error(error.message);
  return ((data as Vet[] | null)?.[0] ?? null);
}

/** Clinic owners manage their details — verification status is admin-only. */
export async function upsertVet(
  vet: Omit<Vet, 'created_at' | 'status' | 'open_now' | 'accepting_now' | 'rating_avg' | 'rating_count'>,
): Promise<void> {
  const { error } = await supabase.from('vets').upsert(vet);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Vet verification documents (migration 014, C1)
// ---------------------------------------------------------------------------

/** Unique-enough storage filename — same rationale as photos.ts's safeId(). */
function safeDocId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Upload any file toward vet verification — no type/validation checks (simplified C1). */
export async function uploadVetDocument(file: File, vetId: string): Promise<void> {
  const path = `${vetId}/${safeDocId()}-${file.name}`;
  const { error: upErr } = await supabase.storage.from('vet-documents').upload(path, file, {
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);

  const { error } = await supabase
    .from('vet_documents')
    .insert({ vet_id: vetId, path, filename: file.name });
  if (error) throw new Error(error.message);
}

/** RLS already limits this to the vet's own documents, or any if caller is admin. */
export async function fetchVetDocuments(vetId: string): Promise<VetDocument[]> {
  const { data, error } = await supabase
    .from('vet_documents')
    .select('*')
    .eq('vet_id', vetId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as VetDocument[];
}

/** The bucket is private — a document is only ever viewed via a short-lived signed URL. */
export async function getVetDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('vet-documents')
    .createSignedUrl(path, 300); // 5 minutes — long enough to open, not to hoard
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function deleteVetDocument(id: string, path: string): Promise<void> {
  const { error: rmErr } = await supabase.storage.from('vet-documents').remove([path]);
  if (rmErr) throw new Error(rmErr.message);
  const { error } = await supabase.from('vet_documents').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Vet ratings (migration 014, C2)
// ---------------------------------------------------------------------------

/** null when this case hasn't been rated yet — used to show/hide the rating prompt. */
export async function fetchRatingForCase(caseId: string): Promise<VetRating | null> {
  const { data, error } = await supabase
    .from('vet_ratings')
    .select('*')
    .eq('case_id', caseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as VetRating | null;
}

/**
 * Insert-only, once per case — RLS enforces the rescuer actually received a
 * confirmed delivery from this vet on this case (migration 014). A second
 * attempt on the same case hits the case_id unique constraint.
 */
export async function rateVet(input: {
  caseId: string;
  vetId: string;
  rescuerId: string;
  rating: number;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.from('vet_ratings').insert({
    case_id: input.caseId,
    vet_id: input.vetId,
    rescuer_id: input.rescuerId,
    rating: input.rating,
    note: input.note?.trim() ?? '',
  });
  if (error) throw new Error(error.message);
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
    Pick<
      Profile,
      | 'display_name'
      | 'locale'
      | 'new_case_pref'
      | 'home_lat'
      | 'home_lng'
      | 'notify_radius_km'
      | 'first_name'
      | 'last_name'
      | 'phone'
    >
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

/**
 * Case chats the user is part of, one row per case (Group D — the Messages
 * tab merges this with fetchInbox() into one list). Membership: cases
 * they're attached to (reporter/rescuer/vet) OR have posted a message in —
 * deliberately NOT case_watchers, since watching is a passive follow, not a
 * conversation. Only cases with at least one message survive the
 * latest-per-case reduction below, so this returns actual chats, not every
 * case the user is merely attached to.
 *
 * NOTE: there is no per-user read marker for case chats (unlike DMs'
 * conversation_participants.last_read_at — case_watchers has no equivalent
 * column), so unlike fetchInbox() this can't compute an `unread` flag.
 * Ordering by recency only for now; adding unread would need a schema
 * change (e.g. a case_watchers.last_read_at column) — flagging, not
 * building, per FIX_SPEC's "no new tables" for this group.
 */
export async function fetchCaseChatInbox(myId: string): Promise<CaseChatInboxEntry[]> {
  const [{ data: attached }, { data: authored }] = await Promise.all([
    supabase
      .from('cases')
      .select('id')
      .or(`reporter_id.eq.${myId},rescuer_id.eq.${myId},vet_id.eq.${myId}`),
    supabase.from('case_messages').select('case_id').eq('sender_id', myId),
  ]);

  const caseIds = Array.from(
    new Set([
      ...(attached ?? []).map((c) => c.id as string),
      ...(authored ?? []).map((m) => m.case_id as string),
    ])
  );
  if (caseIds.length === 0) return [];

  const [{ data: cases }, { data: msgs }, { data: watches }] = await Promise.all([
    supabase.from('cases').select('id, animal, address_hint, status').in('id', caseIds),
    supabase
      .from('case_messages')
      .select('*, sender:profiles (id, display_name, avatar_url, role)')
      .in('case_id', caseIds)
      .order('created_at', { ascending: false })
      .limit(500),
    // migration 017: per-case read marker, mirrors DMs'
    // conversation_participants.last_read_at.
    supabase.from('case_watchers').select('case_id, last_read_at').eq('profile_id', myId).in('case_id', caseIds),
  ]);

  const latest = new Map<string, CaseMessage>();
  const messagesByCase = new Map<string, CaseMessage[]>();
  for (const m of (msgs ?? []) as unknown as CaseMessage[]) {
    if (!latest.has(m.case_id)) latest.set(m.case_id, m);
    (messagesByCase.get(m.case_id) ?? messagesByCase.set(m.case_id, []).get(m.case_id)!).push(m);
  }

  const lastReadByCase = new Map(
    (watches ?? []).map((w) => [w.case_id as string, w.last_read_at as string])
  );

  const entries: CaseChatInboxEntry[] = [];
  for (const c of (cases ?? []) as {
    id: string;
    animal: RescueCase['animal'];
    address_hint: string;
    status: RescueCase['status'];
  }[]) {
    const last = latest.get(c.id);
    if (!last) continue; // no messages yet — not a chat to list

    // No watcher row (e.g. a selected-but-unconfirmed vet who's never
    // opened the chat, unlike DM participants a case_watchers row isn't
    // guaranteed) means never read — anything from someone else is unread,
    // unlike fetchInbox()'s DM logic which treats that edge case as read.
    // Count is capped by the same 500-messages-across-all-cases window
    // used for "latest message" above; a very high-volume case chat could
    // undercount rather than issue a per-case query.
    const lastReadAt = lastReadByCase.get(c.id);
    const unreadMsgs = (messagesByCase.get(c.id) ?? []).filter(
      (m) => m.sender_id !== myId && (!lastReadAt || m.created_at > lastReadAt)
    );

    entries.push({
      caseId: c.id,
      animal: c.animal,
      addressHint: c.address_hint,
      status: c.status,
      lastMessage: last,
      unread: unreadMsgs.length > 0,
      unreadCount: unreadMsgs.length,
    });
  }

  // Newest activity first.
  entries.sort((a, b) => b.lastMessage!.created_at.localeCompare(a.lastMessage!.created_at));
  return entries;
}

/** Migration 017: mark a case chat read (upsert — see the migration's comment on why). */
export const markCaseChatRead = (caseId: string) =>
  rpc('mark_case_chat_read', { p_case: caseId });

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

// Joins in the actual reported content (B3) — the reason alone doesn't tell
// an admin what they'd be hiding/banning. Admin RLS on cases/case_messages
// (migration 003) already lets is_admin() see hidden rows too.
const REPORT_SELECT = `
  *,
  reported_case:cases!content_reports_target_case_fkey (id, description, animal, hidden),
  reported_message:case_messages!content_reports_target_message_fkey (id, body, case_id, hidden),
  reported_profile:profiles!content_reports_target_profile_fkey (id, display_name)
`;

export async function fetchOpenReports(): Promise<ContentReport[]> {
  const { data, error } = await supabase
    .from('content_reports')
    .select(REPORT_SELECT)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ContentReport[];
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

/**
 * Full rows (incl. manager_* / contact_email) for admin review — a plain
 * table select can't do that once migration 014 narrows vets' column
 * grants to the public list, so this goes through the admin RPC instead
 * (SECURITY DEFINER, checks is_admin() itself).
 */
export async function fetchPendingVets(): Promise<Vet[]> {
  const { data, error } = await supabase.rpc('admin_list_pending_vets');
  if (error) throw new Error(error.message);
  return (data ?? []) as Vet[];
}

export const adminSetVetStatus = (vetId: string, status: 'approved' | 'rejected' | 'pending') =>
  rpc('admin_set_vet_status', { p_vet: vetId, p_status: status });

// ---------------------------------------------------------------------------
// Reporter abuse flagging (migration 015, C4)
// ---------------------------------------------------------------------------

export interface ReportedAccount {
  profile_id: string;
  display_name: string;
  report_count: number;
  case_count: number;
  first_report_at: string;
  last_report_at: string;
}

/** Accounts with unusually many open reports against their content recently. */
export async function fetchReportedAccounts(windowDays = 7): Promise<ReportedAccount[]> {
  const { data, error } = await supabase.rpc('admin_reported_accounts', {
    p_window: `${windowDays} days`,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportedAccount[];
}

/** One action: hide every case that account created, ban it, resolve their open reports. */
export const adminFlagAccount = (profileId: string) =>
  rpc('admin_flag_account', { p_profile: profileId });

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

/** Has the current viewer already blocked this specific person? (B4) */
export async function isUserBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const { data } = await supabase
    .from('blocked_users')
    .select('blocked_id')
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId)
    .maybeSingle();
  return !!data;
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
export async function deleteMyAccount(): Promise<void> {
  // Complete, atomic deletion incl. the auth row (migration 009). Cases keep
  // their rescue history with identity detached, per the privacy policy.
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw new Error(error.message);
  await supabase.auth.signOut();
}

/** Record the one-time safety acknowledgment on the server (durable). */
export async function recordSafetyAck(): Promise<void> {
  const { error } = await supabase.rpc('record_safety_ack');
  if (error) throw new Error(error.message);
}
