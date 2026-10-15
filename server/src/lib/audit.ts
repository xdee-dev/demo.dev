import type { Request } from 'express';
import type { Executor } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export interface AuditEntry {
  action: string;           // e.g. 'payment.create', 'rate.update'
  entityType?: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  userId?: string;
}

/** Write an audit row inside the caller's transaction (so it commits/rolls back with the change). */
export async function audit(tx: Executor, req: Request | null, entry: AuditEntry, companyId?: string | null) {
  await tx.insert(auditLogs).values({
    companyId: companyId === undefined ? req?.ctx?.companyId ?? null : companyId,
    userId: entry.userId ?? req?.user?.id ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    before: entry.before === undefined ? null : sanitize(entry.before),
    after: entry.after === undefined ? null : sanitize(entry.after),
    ip: req?.ip ?? null,
    userAgent: req?.get?.('user-agent')?.slice(0, 300) ?? null,
  });
}

const SECRET_KEYS = /password|token|hash|secret/i;
function sanitize(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(sanitize);
  return Object.fromEntries(Object.entries(v as Record<string, unknown>)
    .filter(([k]) => !SECRET_KEYS.test(k))
    .map(([k, x]) => [k, sanitize(x)]));
}

/** Only the keys whose values changed — keeps audit rows small and readable. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    const bv = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const av = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) { b[k] = bv; a[k] = av; }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
