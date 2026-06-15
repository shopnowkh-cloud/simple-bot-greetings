import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | undefined;

function getSql() {
  if (!_sql) {
    const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
    if (!url) {
      throw new Error('SUPABASE_DB_URL or DATABASE_URL must be set.');
    }
    _sql = postgres(url, {
      prepare: false,
      max: 1,
      idle_timeout: 20,
    });
  }
  return _sql;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const sql = getSql();
  const result = await sql.unsafe(text, params as never[]);
  const rows = result as unknown as T[];
  return { rows, rowCount: rows.length };
}
