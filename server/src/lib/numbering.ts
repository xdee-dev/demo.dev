import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { zonedParts } from './dates.js';
import type { CompanySettings, DocType } from './settings.js';

/**
 * Allocates the next document number for (company, docType, period) atomically.
 * The UPSERT takes a row lock, so concurrent requests get distinct sequential numbers;
 * the unique index on each document table is the final safety net.
 */
export async function nextNumber(
  tx: Executor, companyId: string, docType: DocType, settings: CompanySettings, timeZone: string, at: Date = new Date(),
): Promise<string> {
  const fmt = settings.documentFormats[docType];
  const p = zonedParts(at, timeZone);
  const periodKey = fmt.reset === 'MONTHLY' ? `${p.year}${p.month}` : fmt.reset === 'YEARLY' ? p.year : 'ALL';
  const res = await tx.execute<{ last_value: number }>(sql`
    INSERT INTO document_sequences (company_id, doc_type, period_key, last_value)
    VALUES (${companyId}, ${docType}, ${periodKey}, 1)
    ON CONFLICT (company_id, doc_type, period_key)
    DO UPDATE SET last_value = document_sequences.last_value + 1
    RETURNING last_value`);
  const seq = res.rows[0].last_value;
  return renderNumber(fmt.pattern, { prefix: fmt.prefix, pad: fmt.pad, seq, year: p.year, month: p.month, day: p.day });
}

export function renderNumber(pattern: string, v: { prefix: string; pad: number; seq: number; year: string; month: string; day: string }) {
  return pattern
    .replaceAll('{PREFIX}', v.prefix)
    .replaceAll('{YYYY}', v.year)
    .replaceAll('{YY}', v.year.slice(2))
    .replaceAll('{MM}', v.month)
    .replaceAll('{DD}', v.day)
    .replaceAll('{SEQ}', String(v.seq).padStart(v.pad, '0'));
}
