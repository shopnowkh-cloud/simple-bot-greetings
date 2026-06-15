import { supabaseAdmin } from '@/integrations/supabase/client.server';

// Worker-compatible SQL runner: dispatches to the server-side `public.exec_sql`
// Postgres function via PostgREST (fetch-based, no TCP). Keeps the same
// `{ rows, rowCount }` shape as the previous pg/postgres.js implementation.
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const query_params = params.map((p) =>
    p === null || p === undefined ? null : typeof p === 'string' ? p : String(p),
  );
  const { data, error } = await supabaseAdmin.rpc('exec_sql', {
    query_text: text,
    query_params,
  });
  if (error) {
    throw new Error(`exec_sql failed: ${error.message}`);
  }
  const rows = (Array.isArray(data) ? data : []) as T[];
  return { rows, rowCount: rows.length };
}
