import { sql } from 'drizzle-orm';
import { db, type Tx } from './client.js';

/**
 * Runs `fn` in a transaction scoped to one company. `app.company_id` is transaction-local
 * (set_config(..., true)), so it can never leak to another request sharing the pooled
 * connection. RLS policies use it to filter every tenant table.
 */
export async function withTenant<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    return fn(tx);
  });
}

/** Platform-level transaction (super admin / auth events): may write audit rows with company_id NULL. */
export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.platform', 'on', true)`);
    return fn(tx);
  });
}
