import { sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { conflict } from '../lib/errors.js';

export type BlockSource = 'RESERVATION' | 'RENTAL' | 'MAINTENANCE';

export interface ConflictRow extends Record<string, unknown> {
  source_type: BlockSource;
  source_id: string;
  lower: string;
  upper: string | null;
  label: string | null;
}

/**
 * Vehicle availability policy
 * ----------------------------
 * A vehicle is blocked by:
 *   • reservations in status PENDING / CONFIRMED (DRAFT only if the company enables it)
 *   • rental transactions in status SCHEDULED / ONGOING (and the actually-used period of RETURNED/COMPLETED)
 *   • maintenance in status SCHEDULED / IN_PROGRESS (IN_PROGRESS without end date blocks indefinitely)
 *   • an ONGOING rental that is already overdue blocks "now" until the vehicle is actually returned
 * Cancelled reservations/rentals/maintenance release their block (active = false).
 * The DB exclusion constraint `vehicle_schedule_no_overlap` is the final guarantee.
 */
export async function findConflicts(
  tx: Tx, vehicleId: string, start: Date, end: Date | null, exclude?: { type: BlockSource; id: string },
): Promise<ConflictRow[]> {
  const upper = end ? end.toISOString() : null;
  const res = await tx.execute<ConflictRow>(sql`
    select b.source_type, b.source_id, lower(b.period)::text as lower, upper(b.period)::text as upper,
      coalesce(
        (select 'Reservasi ' || r.number || ' — ' || (r.customer_snapshot->>'name') from reservations r where b.source_type = 'RESERVATION' and r.id = b.source_id),
        (select 'Transaksi ' || t.number || ' — ' || (t.customer_snapshot->>'name') from rental_transactions t where b.source_type = 'RENTAL' and t.id = b.source_id),
        (select 'Perawatan ' || m.number || ' — ' || m.service_type from maintenance_records m where b.source_type = 'MAINTENANCE' and m.id = b.source_id)
      ) as label
    from vehicle_schedule_blocks b
    where b.vehicle_id = ${vehicleId} and b.active
      and b.period && tstzrange(${start.toISOString()}::timestamptz, ${upper}::timestamptz, '[)')
      ${exclude ? sql`and not (b.source_type = ${exclude.type} and b.source_id = ${exclude.id})` : sql``}
    union all
    -- overdue rental still out: the vehicle is not back yet
    select 'RENTAL'::block_source, t.id, t.start_at::text, null, 'Transaksi ' || t.number || ' — belum dikembalikan (terlambat)'
    from rental_transactions t
    where t.vehicle_id = ${vehicleId} and t.status = 'ONGOING' and t.end_at < now()
      and ${start.toISOString()}::timestamptz < now() + interval '1 hour'
      ${exclude ? sql`and not (${exclude.type} = 'RENTAL' and t.id = ${exclude.id})` : sql``}
    limit 5`);
  return res.rows;
}

export async function assertAvailable(tx: Tx, vehicleId: string, start: Date, end: Date | null, exclude?: { type: BlockSource; id: string }) {
  const rows = await findConflicts(tx, vehicleId, start, end, exclude);
  if (rows.length) {
    throw conflict('Kendaraan tidak tersedia pada periode tersebut — jadwal bentrok', { conflicts: rows }, 'SCHEDULE_CONFLICT');
  }
}

/**
 * Create or update the block for a source. When `active` is true the exclusion constraint
 * re-validates the period under concurrency (two simultaneous requests: one wins, the other
 * receives SQLSTATE 23P01 → HTTP 409).
 */
export async function upsertBlock(
  tx: Tx, companyId: string, b: { vehicleId: string; type: BlockSource; id: string; start: Date; end: Date | null; active: boolean },
) {
  await tx.execute(sql`
    insert into vehicle_schedule_blocks (company_id, vehicle_id, source_type, source_id, period, active)
    values (${companyId}, ${b.vehicleId}, ${b.type}, ${b.id},
      tstzrange(${b.start.toISOString()}::timestamptz, ${b.end ? b.end.toISOString() : null}::timestamptz, '[)'), ${b.active})
    on conflict (source_type, source_id) do update
      set vehicle_id = excluded.vehicle_id, period = excluded.period, active = excluded.active`);
}

export async function setBlockActive(tx: Tx, type: BlockSource, id: string, active: boolean) {
  await tx.execute(sql`update vehicle_schedule_blocks set active = ${active} where source_type = ${type} and source_id = ${id}`);
}

export async function transferBlock(tx: Tx, from: { type: BlockSource; id: string }, to: { type: BlockSource; id: string }) {
  await tx.execute(sql`update vehicle_schedule_blocks set source_type = ${to.type}, source_id = ${to.id}
    where source_type = ${from.type} and source_id = ${from.id}`);
}

/** SQL expression computing the live status of vehicle alias `v`. */
export const vehicleStatusSql = sql`(case
  when v.archived_at is not null or not v.is_active then 'INACTIVE'
  when exists (select 1 from vehicle_schedule_blocks b where b.vehicle_id = v.id and b.active and b.source_type = 'MAINTENANCE' and b.period @> now()) then 'MAINTENANCE'
  when exists (select 1 from rental_transactions r where r.vehicle_id = v.id and r.status = 'ONGOING') then 'RENTED'
  when exists (select 1 from vehicle_schedule_blocks b where b.vehicle_id = v.id and b.active and b.source_type in ('RESERVATION','RENTAL') and b.period @> now()) then 'BOOKED'
  else 'AVAILABLE' end)`;

/**
 * Used when recording something that already happened physically (late return, maintenance
 * finished late): try to extend the block to the real end; if that collides with the next
 * booking, keep the planned end and return a warning instead of refusing the record.
 */
export async function upsertBlockLenient(
  tx: Tx, companyId: string, b: { vehicleId: string; type: BlockSource; id: string; start: Date; end: Date | null; active: boolean }, fallbackEnd: Date | null,
): Promise<string | null> {
  try {
    await tx.transaction(async (sp) => { await upsertBlock(sp, companyId, b); });
    return null;
  } catch (e) {
    const code = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
    if (code !== '23P01') throw e;
    await upsertBlock(tx, companyId, { ...b, end: fallbackEnd });
    return 'Waktu aktual bertabrakan dengan jadwal berikutnya pada kendaraan ini. Periksa kalender dan sesuaikan jadwal berikutnya.';
  }
}
