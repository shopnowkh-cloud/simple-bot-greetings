// Supabase auth has been removed. Auth is handled via admin_tokens in PostgreSQL.
// This file is kept as a no-op to avoid breaking any imports.
import { createMiddleware } from '@tanstack/react-start';

export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => next({}),
);
