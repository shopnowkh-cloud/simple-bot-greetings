import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | undefined;

function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set.');
    }
    _sql = postgres(process.env.DATABASE_URL, {
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
