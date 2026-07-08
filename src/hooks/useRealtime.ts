/**
 * Realtime data hooks.
 *
 * Pattern used throughout: fetch once, then subscribe to postgres_changes
 * and refetch (or append) on change. Refetch-on-change keeps joined data
 * (photos, rescuer, vet) consistent without duplicating join logic client-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  fetchCase,
  fetchCaseEvents,
  fetchCaseMessages,
  fetchCases,
  fetchMessages,
  fetchNotifications,
} from '../lib/api';
import type {
  AppNotification,
  CaseEvent,
  CaseMessage,
  CaseWithDetails,
  DirectMessage,
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

/** Debounced refetcher — bursts of changes collapse into one query. */
function useRefetch(fn: () => Promise<void>, delayMs = 250) {
  const timer = useRef<number | null>(null);
  return useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void fn(), delayMs);
  }, [fn, delayMs]);
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
    const channel = supabase
      .channel(uniqueTopic('cases-list'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, refetch)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'case_photos' }, refetch)
      .subscribe();
    return () => void supabase.removeChannel(channel);
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
    const channel = supabase
      .channel(uniqueTopic(`case-${caseId}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cases', filter: `id=eq.${caseId}` },
        refetch
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'case_events', filter: `case_id=eq.${caseId}` },
        refetch
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'case_photos', filter: `case_id=eq.${caseId}` },
        refetch
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [caseId, load, refetch]);

  return { caseData, events, loading, reload: load };
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
    const channel = supabase
      .channel(uniqueTopic(`notifications-${profileId}`))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${profileId}`,
        },
        refetch
      )
      .subscribe();
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
    const channel = supabase
      .channel(uniqueTopic(`case-chat-${caseId}`))
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'case_messages',
          filter: `case_id=eq.${caseId}`,
        },
        // Refetch (not append) so the sender join is populated.
        refetch
      )
      .subscribe();
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
    const channel = supabase
      .channel(uniqueTopic(`dm-${conversationId}`))
      .on(
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
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [conversationId, load]);

  return { messages, loading };
}
