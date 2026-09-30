/**
 * Realtime data hooks.
 *
 * Pattern used throughout: fetch once, then subscribe to postgres_changes
 * and refetch (or append) on change. Refetch-on-change keeps joined data
 * (photos, rescuer, vet) consistent without duplicating join logic client-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { captureError } from '../lib/monitoring';
import {
  fetchCase,
  fetchCaseEvents,
  fetchCaseMessages,
  fetchCases,
  fetchMessages,
  fetchNotifications,
  fetchRescuerLocation,
  purgeCachedCasePhotos,
} from '../lib/api';
import type {
  AppNotification,
  CaseEvent,
  CaseMessage,
  CaseWithDetails,
  DirectMessage,
  RescuerLocation,
} from '../lib/types';

/**
 * Channel topics must be unique per subscription — the same hook can be
 * mounted twice at once (e.g. the nav badge and the Alerts page both use
 * useNotifications), and duplicate topics on one client cause subscribe
 * errors. A random suffix keeps every subscription independent.
 */
function uniqueTopic(base: string): string {
  return `${base}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * ⚠ ONLY SUBSCRIBE TO TABLES IN THE supabase_realtime PUBLICATION.
 * As of 001 §9 that is exactly: cases, case_events, case_messages, messages,
 * notifications. case_photos and case_watchers are NOT published.
 *
 * This is not a "that binding is merely inert" matter — one bad binding kills
 * the whole channel. Every postgres_changes binding on a channel goes to the
 * server as ONE array in the join payload, and realtime-js matches the
 * server's reply against the client list POSITIONALLY: if any entry is
 * missing or doesn't match, _updatePostgresBindings() calls unsubscribe() and
 * errors the entire channel — taking the good bindings with it
 * (RealtimeChannel.ts, @supabase/realtime-js). A single unpublished table in
 * the list therefore silently kills live updates for everything else on that
 * channel, which is exactly how case status stopped updating in place.
 *
 * This helper subscribes and REPORTS a channel that fails to establish,
 * instead of leaving it silently dead: `.subscribe()` with no callback
 * swallows CHANNEL_ERROR entirely, which is why the above went unnoticed —
 * the affected screens simply stopped updating, with nothing logged anywhere.
 */
function subscribeReporting(channel: RealtimeChannel, label: string): RealtimeChannel {
  return channel.subscribe((status, err) => {
    if (
      status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
      status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
    ) {
      captureError(
        new Error(`PawLine: realtime channel "${label}" ${status}: ${err?.message ?? 'no detail'}`)
      );
    }
  });
}

/**
 * Case change notifications, 036-aware. Migration 036 takes `cases` out of
 * the realtime publication (full rows carried server-only data) and
 * publishes a tiny `case_signals` table instead: case_id + hidden, bumped by
 * a trigger whenever a public column changes. Subscribe to that first; if
 * its channel can't be established (036 not applied yet) fall back to
 * watching `cases` directly, as before. Separate channels, because one
 * unpublished table errors the whole channel (see subscribeReporting).
 */
function subscribeCaseChanges(
  label: string,
  caseId: string | null,
  onChange: (payload: { new?: { id?: string; case_id?: string; hidden?: boolean } }) => void
): () => void {
  let closed = false;
  let fallback: RealtimeChannel | null = null;
  const primary = supabase
    .channel(uniqueTopic(`${label}-signals`))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'case_signals', ...(caseId ? { filter: `case_id=eq.${caseId}` } : {}) },
      onChange
    );
  primary.subscribe((status) => {
    if (closed || fallback) return;
    if (
      status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
      status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
    ) {
      void supabase.removeChannel(primary);
      fallback = subscribeReporting(
        supabase
          .channel(uniqueTopic(label))
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'cases', ...(caseId ? { filter: `id=eq.${caseId}` } : {}) },
            onChange
          ),
        label
      );
    }
  });
  return () => {
    closed = true;
    void supabase.removeChannel(primary);
    if (fallback) void supabase.removeChannel(fallback);
  };
}

/** Debounced refetcher — bursts of changes collapse into one query. */
function useRefetch(fn: () => Promise<void>, delayMs = 250) {
  const timer = useRef<number | null>(null);
  return useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void fn(), delayMs);
  }, [fn, delayMs]);
}

/**
 * Migration 018 (A2): if this change just made a case hidden, tell this
 * tab's own service worker to drop any cached copies of its photos —
 * reaches every currently-open tab watching this case/the feed, not just
 * the admin's device that clicked "hide" (adminHideCase() covers that one
 * directly). Not gated on payload.old (Postgres only guarantees `old`
 * carries every column with REPLICA IDENTITY FULL, which cases doesn't
 * have) — purging an already-hidden or already-purged case is a harmless
 * no-op, so checking `new.hidden` alone is enough.
 */
function purgeIfHidden(payload: { new?: { id?: string; case_id?: string; hidden?: boolean } }) {
  // case_signals rows carry case_id; `cases` rows (pre-036 fallback) carry id.
  const id = payload.new?.case_id ?? payload.new?.id;
  if (payload.new?.hidden && id) purgeCachedCasePhotos(id);
}

// ---------------------------------------------------------------------------
// All cases (map + feed) — live.
// ---------------------------------------------------------------------------
export function useCases() {
  const [cases, setCases] = useState<CaseWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCases(await fetchCases());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useRefetch(load);

  useEffect(() => {
    void load();
    // No case_photos binding: unpublished (see subscribeReporting's note), so
    // it never delivered anything and took this whole channel down with it.
    // A case's photos are written while it is being created, so the `cases`
    // INSERT this channel already watches brings the row in with them.
    return subscribeCaseChanges('cases-list', null, (payload) => {
      purgeIfHidden(payload);
      refetch();
    });
  }, [load, refetch]);

  return { cases, loading, error, reload: load };
}

// ---------------------------------------------------------------------------
// One case + its timeline — live.
// ---------------------------------------------------------------------------
export function useCase(caseId: string | undefined) {
  const [caseData, setCaseData] = useState<CaseWithDetails | null>(null);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!caseId) return;
    try {
      const [c, ev] = await Promise.all([fetchCase(caseId), fetchCaseEvents(caseId)]);
      setCaseData(c);
      setEvents(ev);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  const refetch = useRefetch(load);

  useEffect(() => {
    if (!caseId) return;
    void load();
    // These two tables carry every status transition: the RPCs update `cases`
    // and insert a `case_events` row. The case_photos binding that used to sit
    // here is gone — unpublished, so it delivered nothing while erroring the
    // channel, which is what stopped status from updating live for BOTH the
    // acting user and the observer. Delivery photos are covered by the acting
    // client's own reload().
    const unsubscribeCase = subscribeCaseChanges(`case-${caseId}`, caseId, (payload) => {
      purgeIfHidden(payload);
      refetch();
    });
    const events = subscribeReporting(
      supabase
        .channel(uniqueTopic(`case-events-${caseId}`))
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'case_events', filter: `case_id=eq.${caseId}` },
          refetch
        ),
      `case-events-${caseId}`
    );
    return () => {
      unsubscribeCase();
      void supabase.removeChannel(events);
    };
  }, [caseId, load, refetch]);

  return { caseData, events, loading, reload: load };
}

// ---------------------------------------------------------------------------
// The rescuer's live position on one case — participants only (036).
// ---------------------------------------------------------------------------
const LOCATION_POLL_MS = 30_000;

/**
 * Only fetches while `enabled` (the case is vet_confirmed / en_route). After
 * 036 the row comes from case_rescuer_locations — RLS hands it only to the
 * reporter, rescuer, vet and admins; everyone else gets null — and updates
 * live via realtime. Before 036 it is read from the `cases` row. A 30 s poll
 * backs up both (the rescuer's device shares roughly every 45 s).
 */
export function useRescuerLocation(caseId: string | undefined, enabled: boolean): RescuerLocation | null {
  const [location, setLocation] = useState<RescuerLocation | null>(null);

  useEffect(() => {
    if (!caseId || !enabled) {
      setLocation(null);
      return;
    }
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    const load = async () => {
      try {
        const { location: loc, live } = await fetchRescuerLocation(caseId);
        if (cancelled) return;
        setLocation(loc);
        if (live && !channel) {
          channel = subscribeReporting(
            supabase
              .channel(uniqueTopic(`rescuer-location-${caseId}`))
              .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'case_rescuer_locations', filter: `case_id=eq.${caseId}` },
                () => void load()
              ),
            `rescuer-location-${caseId}`
          );
        }
      } catch {
        /* non-fatal: the map just shows no car */
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), LOCATION_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [caseId, enabled]);

  return location;
}

// ---------------------------------------------------------------------------
// Notifications — live, with unread count for the tab badge.
// ---------------------------------------------------------------------------
export function useNotifications(profileId: string | undefined) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profileId) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      setItems(await fetchNotifications(profileId));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  const refetch = useRefetch(load);

  useEffect(() => {
    void load();
    if (!profileId) return;
    const channel = subscribeReporting(
      supabase.channel(uniqueTopic(`notifications-${profileId}`)).on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${profileId}`,
        },
        refetch
      ),
      'notifications'
    );
    return () => void supabase.removeChannel(channel);
  }, [profileId, load, refetch]);

  const unread = items.filter((n) => !n.read).length;
  return { notifications: items, unread, loading, reload: load };
}

// ---------------------------------------------------------------------------
// Case group chat — live, append-on-insert for snappy feel.
// ---------------------------------------------------------------------------
export function useCaseChat(caseId: string | undefined) {
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!caseId) return;
    try {
      setMessages(await fetchCaseMessages(caseId));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  const refetch = useRefetch(load, 120);

  useEffect(() => {
    if (!caseId) return;
    void load();
    const channel = subscribeReporting(
      supabase.channel(uniqueTopic(`case-chat-${caseId}`)).on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'case_messages',
          filter: `case_id=eq.${caseId}`,
        },
        // Refetch (not append) so the sender join is populated.
        refetch
      ),
      `case-chat-${caseId}`
    );
    return () => void supabase.removeChannel(channel);
  }, [caseId, load, refetch]);

  return { messages, loading, reload: load };
}

// ---------------------------------------------------------------------------
// Direct-message thread — live.
// ---------------------------------------------------------------------------
export function useDmThread(conversationId: string | undefined) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!conversationId) return;
    try {
      setMessages(await fetchMessages(conversationId));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    void load();
    const channel = subscribeReporting(
      supabase.channel(uniqueTopic(`dm-${conversationId}`)).on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) => {
            const msg = payload.new as DirectMessage;
            return prev.some((m) => m.id === msg.id) ? prev : [...prev, msg];
          });
        }
      ),
      `dm-${conversationId}`
    );
    return () => void supabase.removeChannel(channel);
  }, [conversationId, load]);

  return { messages, loading };
}
