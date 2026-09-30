// ============================================================================
// PawLine — delete-account Edge Function
// ----------------------------------------------------------------------------
// Self-serve account deletion, database AND files. The database part is
// delete_my_account() (009, fixed in 037), called here with the caller's own
// JWT so it still deletes only auth.uid(). This function adds what SQL cannot
// do properly: removing the caller's files from Storage. Deleting
// storage.objects rows from SQL leaves the bytes in the bucket (and Supabase
// blocks direct deletes on storage tables), so files go through the Storage
// API with the service role.
//
// Files removed: vet-documents/<uid>/* (clinic verification documents).
// Avatars are not stored by us — profiles.avatar_url is the OAuth provider's
// picture URL — so there is nothing to delete for them. Report photos in
// case-photos belong to the case, which stays, so they stay too.
//
// Order: list files → delete_my_account() → remove files. The RPC is the step
// that can fail; running it first means a failed deletion never costs a vet
// their verification documents. If file removal fails after the account is
// gone, the leftovers are findable (docs/OPERATOR_GUIDE.md, "Orphaned vet
// documents") because the folder name is a uid with no profile.
//
// Deploy:  supabase functions deploy delete-account
// (JWT verification stays ON — the caller must be signed in.)
//
// ⚠ SECURITY: uses the SERVICE ROLE key (injected by Supabase), only for the
// Storage calls, and only on the folder named after the verified caller.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });

/** Every object path under `<folder>/` in a bucket (paged; docs sit flat in the folder). */
async function listFolder(bucket: string, folder: string): Promise<string[]> {
  const paths: string[] = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit, offset });
    if (error) throw error;
    // Folders come back with id === null; the convention has none, skip any.
    for (const o of data ?? []) if (o.id) paths.push(`${folder}/${o.name}`);
    if (!data || data.length < limit) return paths;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('authorization') ?? '';
  const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const uid = userData?.user?.id;
  if (userErr || !uid) return json({ error: 'Not signed in.' }, 401);

  // 1. What to remove, before the account (and its vets row) is gone.
  let docPaths: string[];
  try {
    docPaths = await listFolder('vet-documents', uid);
  } catch (e) {
    return json({ error: `Could not list your files: ${(e as Error).message}` }, 500);
  }

  // 2. The database deletion, as the caller (auth.uid() = uid). Atomic.
  const { error: rpcErr } = await asUser.rpc('delete_my_account');
  if (rpcErr) return json({ error: rpcErr.message }, 400);

  // 3. The files. The account is already gone, so report but do not fail.
  let filesRemoved = true;
  if (docPaths.length > 0) {
    const { error: rmErr } = await admin.storage.from('vet-documents').remove(docPaths);
    if (rmErr) {
      filesRemoved = false;
      console.error(`delete-account: storage cleanup failed for ${uid}: ${rmErr.message}`);
    }
  }

  return json({ deleted: true, filesRemoved });
});
