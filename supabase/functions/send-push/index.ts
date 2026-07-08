// ============================================================================
// PawLine — send-push Edge Function
// ----------------------------------------------------------------------------
// Delivers a Web Push message for every new row in public.notifications.
// Wire-up (full steps in docs/DEPLOYMENT.md):
//
//   1. Generate VAPID keys once:  npx web-push generate-vapid-keys
//   2. supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//        VAPID_SUBJECT=mailto:you@example.com PUSH_WEBHOOK_SECRET=<random string>
//   3. supabase functions deploy send-push --no-verify-jwt
//   4. Dashboard → Database → Webhooks → new webhook:
//        table public.notifications, event INSERT, type = Supabase Edge Function
//        → send-push, HTTP header  x-push-secret: <same random string>
//
// ⚠ SECURITY: this function uses the SERVICE ROLE key (injected automatically
// as an env var by Supabase). That key bypasses Row Level Security entirely —
// it must NEVER appear in frontend code or the git repo. Here it only reads
// push_subscriptions and deletes dead ones.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

interface NotificationRow {
  id: number;
  profile_id: string;
  title: string;
  body: string;
  case_id: string | null;
  conversation_id: string | null;
}

Deno.serve(async (req) => {
  // Only our own database webhook may call this.
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (secret && req.headers.get('x-push-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  const record: NotificationRow | undefined = payload?.record;
  if (!record?.profile_id) {
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('profile_id', record.profile_id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Deep link for the notification click.
  const url = record.case_id
    ? `/case/${record.case_id}`
    : record.conversation_id
      ? `/messages/${record.conversation_id}`
      : '/alerts';

  const message = JSON.stringify({ title: record.title, body: record.body, url });

  let sent = 0;
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        message,
        { TTL: 60 * 60 } // an hour — rescue alerts are useless when stale
      );
      sent++;
    } catch (e) {
      // 404/410 = the browser revoked this subscription — clean it up.
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { 'content-type': 'application/json' },
  });
});
