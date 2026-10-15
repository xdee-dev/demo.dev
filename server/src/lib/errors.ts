import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Silakan login terlebih dahulu') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Anda tidak memiliki izin untuk tindakan ini') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Data') => new AppError(404, 'NOT_FOUND', `${what} tidak ditemukan`);
export const conflict = (message: string, details?: unknown, code = 'CONFLICT') => new AppError(409, code, message, details);

interface PgError { code?: string; constraint?: string; detail?: string; message?: string }

const constraintMessages: Record<string, string> = {
  vehicle_schedule_no_overlap: 'Jadwal kendaraan bentrok dengan reservasi, transaksi, atau perawatan lain pada periode tersebut',
  vehicles_company_plate_uq: 'Nomor polisi sudah terdaftar di perusahaan ini',
  vehicles_company_code_uq: 'Kode kendaraan sudah digunakan',
  customers_company_code_uq: 'Kode customer sudah digunakan',
  company_memberships_company_user_uq: 'Pengguna sudah menjadi anggota perusahaan ini',
  cash_accounts_company_name_uq: 'Nama akun kas sudah digunakan',
  expense_categories_company_code_uq: 'Kode kategori sudah digunakan',
  companies_slug_unique: 'Slug perusahaan sudah digunakan',
  users_email_unique: 'Email sudah terdaftar',
  payments_reverses_uq: 'Pembayaran ini sudah pernah dibatalkan (reversal)',
};

/** Convert known PostgreSQL errors into safe, user-facing AppErrors. */
export function fromPgError(err: unknown): AppError | null {
  const e = (err as { cause?: PgError })?.cause ?? (err as PgError);
  if (!e || typeof e.code !== 'string') return null;
  switch (e.code) {
    case '23P01':
      return conflict(constraintMessages[e.constraint ?? ''] ?? 'Data bentrok dengan data lain', undefined, 'SCHEDULE_CONFLICT');
    case '23505':
      return conflict(constraintMessages[e.constraint ?? ''] ?? 'Data duplikat — nilai unik sudah digunakan', undefined, 'DUPLICATE');
    case '23503':
      return badRequest('Data referensi tidak valid atau tidak dapat dihapus karena masih digunakan');
    case '23514':
      return badRequest('Data tidak memenuhi aturan validasi');
    case '42501':
      return forbidden('Akses ke data ini ditolak');
    case 'P0001':
      return conflict(e.message ?? 'Operasi tidak diizinkan');
    case '22P02':
      return badRequest('Format data tidak valid');
    default:
      return null;
  }
}

export function zodToDetails(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return { fields };
}
