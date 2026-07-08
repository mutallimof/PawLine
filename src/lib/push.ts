/**
 * Web Push subscription management (client side).
 *
 * Flow: user taps "Enable push" in Profile → browser permission prompt →
 * we subscribe via the service worker using the public VAPID key → the
 * subscription is stored in push_subscriptions → the send-push Edge
 * Function delivers to it whenever a notifications row is created.
 *
 * Requires HTTPS (or localhost) and VITE_VAPID_PUBLIC_KEY in .env.
 * iOS note: on iPhone/iPad, Web Push only works after the app has been
 * added to the home screen (iOS 16.4+) — worth telling users.
 */
import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function pushSupported(): boolean {
  return (
    !!VAPID_PUBLIC_KEY &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush(profileId: string): Promise<void> {
  if (!pushSupported()) throw new Error('push-unsupported');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('push-denied');

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
    }));

  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      profile_id: profileId,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw new Error(error.message);
}

export async function disablePush(): Promise<void> {
  const sub = await getPushSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Standard VAPID key conversion. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
