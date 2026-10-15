import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { companySettings } from '../db/schema.js';

export const DOC_TYPES = ['CUSTOMER', 'VEHICLE', 'DRIVER', 'RESERVATION', 'RENTAL', 'INVOICE', 'CONTRACT', 'PAYMENT', 'EXPENSE', 'INCOME', 'MAINTENANCE'] as const;
export type DocType = (typeof DOC_TYPES)[number];

const docFormat = z.object({
  prefix: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-]+$/, 'Prefix hanya huruf, angka, dan tanda minus'),
  pattern: z.string().trim().min(5).max(60).refine((s) => s.includes('{SEQ}'), 'Pola wajib mengandung {SEQ}'),
  reset: z.enum(['NEVER', 'YEARLY', 'MONTHLY']),
  pad: z.number().int().min(1).max(8),
});
export type DocFormat = z.infer<typeof docFormat>;

const defaultFormats: Record<DocType, DocFormat> = {
  CUSTOMER: { prefix: 'CUS', pattern: '{PREFIX}-{SEQ}', reset: 'NEVER', pad: 5 },
  VEHICLE: { prefix: 'KND', pattern: '{PREFIX}-{SEQ}', reset: 'NEVER', pad: 4 },
  DRIVER: { prefix: 'DRV', pattern: '{PREFIX}-{SEQ}', reset: 'NEVER', pad: 3 },
  RESERVATION: { prefix: 'RSV', pattern: '{PREFIX}/{YYYY}{MM}/{SEQ}', reset: 'MONTHLY', pad: 4 },
  RENTAL: { prefix: 'TRX', pattern: '{PREFIX}/{YYYY}{MM}/{SEQ}', reset: 'MONTHLY', pad: 4 },
  INVOICE: { prefix: 'INV', pattern: '{PREFIX}/{YYYY}/{MM}/{SEQ}', reset: 'MONTHLY', pad: 4 },
  CONTRACT: { prefix: 'SPR', pattern: '{PREFIX}/{YYYY}/{MM}/{SEQ}', reset: 'MONTHLY', pad: 4 },
  PAYMENT: { prefix: 'KWT', pattern: '{PREFIX}/{YYYY}{MM}/{SEQ}', reset: 'MONTHLY', pad: 4 },
  EXPENSE: { prefix: 'EXP', pattern: '{PREFIX}/{YYYY}{MM}/{SEQ}', reset: 'MONTHLY', pad: 4 },
  INCOME: { prefix: 'INC', pattern: '{PREFIX}/{YYYY}{MM}/{SEQ}', reset: 'MONTHLY', pad: 4 },
  MAINTENANCE: { prefix: 'SRV', pattern: '{PREFIX}/{YYYY}{MM}/{SEQ}', reset: 'MONTHLY', pad: 4 },
};

const moneyStr = z.union([z.string(), z.number()]).transform((v) => String(v));

export const settingsSchema = z.object({
  taxPercent: moneyStr.default('0'),
  graceMinutes: z.number().int().min(0).max(24 * 60).default(60),
  lateFeeMode: z.enum(['PER_DAY', 'PER_HOUR']).default('PER_DAY'),
  lateFeePerHour: moneyStr.default('0'),
  moneyDecimals: z.union([z.literal(0), z.literal(2)]).default(0),
  requireFullPaymentToComplete: z.boolean().default(true),
  reservationBlocksDraft: z.boolean().default(false),
  paymentMethods: z.array(z.object({ code: z.string().trim().min(1).max(20), label: z.string().trim().min(1).max(40) }))
    .min(1).default([
      { code: 'CASH', label: 'Tunai' },
      { code: 'TRANSFER', label: 'Transfer Bank' },
      { code: 'CARD', label: 'Kartu Debit/Kredit' },
      { code: 'QRIS', label: 'QRIS' },
    ]),
  documentFormats: z.record(z.string(), docFormat).default(defaultFormats),
  print: z.object({
    rentalTerms: z.string().max(10000).default([
      'Penyewa wajib menunjukkan identitas asli (KTP/SIM) yang masih berlaku.',
      'Kendaraan wajib dikembalikan pada waktu dan tempat yang telah disepakati. Keterlambatan dikenakan denda sesuai ketentuan.',
      'Penyewa bertanggung jawab atas kerusakan, kehilangan, dan pelanggaran lalu lintas selama masa sewa.',
      'Kendaraan tidak boleh dipindahtangankan, disewakan kembali, atau digunakan untuk kegiatan melanggar hukum.',
      'Bahan bakar dikembalikan pada level yang sama seperti saat serah terima.',
      'Pembatalan setelah konfirmasi dapat dikenakan biaya pembatalan.',
    ].join('\n')),
    invoiceNotes: z.string().max(2000).default('Pembayaran dapat ditransfer ke rekening perusahaan yang tercantum.'),
    receiptNotes: z.string().max(2000).default('Kwitansi ini sah sebagai bukti pembayaran.'),
    footerText: z.string().max(500).default('Terima kasih atas kepercayaan Anda.'),
    signatureCompanyLabel: z.string().max(60).default('Pihak Rental'),
    signatureCustomerLabel: z.string().max(60).default('Penyewa'),
    showBankAccounts: z.boolean().default(true),
    receiptSize: z.enum(['A4', 'A5']).default('A5'),
  }).prefault({}),
});

export type CompanySettings = z.infer<typeof settingsSchema>;

export function parseSettings(data: unknown): CompanySettings {
  const parsed = settingsSchema.parse(data ?? {});
  // ensure every doc type has a format, even if new types were added after the row was saved
  parsed.documentFormats = { ...defaultFormats, ...parsed.documentFormats };
  return parsed;
}

export const defaultSettings = (): CompanySettings => parseSettings({});

export async function getSettings(tx: Executor, companyId: string): Promise<CompanySettings> {
  const row = await tx.query.companySettings.findFirst({ where: eq(companySettings.companyId, companyId) });
  return parseSettings(row?.data ?? {});
}

export async function saveSettings(tx: Executor, companyId: string, data: CompanySettings, userId: string | null) {
  await tx.insert(companySettings).values({ companyId, data, updatedBy: userId })
    .onConflictDoUpdate({ target: companySettings.companyId, set: { data, updatedBy: userId, updatedAt: sql`now()` } });
}
