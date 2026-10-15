export type Tone = 'neutral' | 'brand' | 'teal' | 'warn' | 'danger' | 'muted';

export const RENTAL_STATUS: Record<string, [string, Tone]> = {
  SCHEDULED: ['Terjadwal', 'brand'], ONGOING: ['Sedang disewa', 'teal'], RETURNED: ['Dikembalikan', 'warn'],
  COMPLETED: ['Selesai', 'neutral'], CANCELLED: ['Dibatalkan', 'muted'],
};
export const RESERVATION_STATUS: Record<string, [string, Tone]> = {
  DRAFT: ['Draft', 'muted'], PENDING: ['Menunggu konfirmasi', 'warn'], CONFIRMED: ['Dikonfirmasi', 'brand'],
  ACTIVE: ['Aktif (jadi transaksi)', 'teal'], COMPLETED: ['Selesai', 'neutral'], CANCELLED: ['Dibatalkan', 'muted'],
};
export const PAYMENT_STATUS: Record<string, [string, Tone]> = {
  UNPAID: ['Belum dibayar', 'danger'], DP_PAID: ['DP dibayar', 'warn'], PARTIAL: ['Pembayaran sebagian', 'warn'],
  PAID: ['Lunas', 'teal'], REFUND_DUE: ['Perlu pengembalian dana', 'danger'],
};
export const VEHICLE_STATUS: Record<string, [string, Tone]> = {
  AVAILABLE: ['Tersedia', 'teal'], BOOKED: ['Dipesan', 'brand'], RENTED: ['Sedang disewa', 'warn'],
  MAINTENANCE: ['Dalam perawatan', 'danger'], INACTIVE: ['Tidak aktif', 'muted'],
};
export const MAINTENANCE_STATUS: Record<string, [string, Tone]> = {
  SCHEDULED: ['Terjadwal', 'brand'], IN_PROGRESS: ['Dikerjakan', 'warn'], DONE: ['Selesai', 'teal'], CANCELLED: ['Dibatalkan', 'muted'],
};
export const PAYMENT_KIND: Record<string, [string, Tone]> = {
  PAYMENT: ['Pembayaran', 'teal'], REFUND: ['Refund', 'warn'], REVERSAL: ['Reversal', 'danger'],
};
export const CUSTOMER_STATUS: Record<string, [string, Tone]> = {
  ACTIVE: ['Aktif', 'teal'], INACTIVE: ['Tidak aktif', 'muted'], BLACKLISTED: ['Blacklist', 'danger'],
};
export const RENTAL_TYPE: Record<string, string> = { DAILY: 'Harian', WEEKLY: 'Mingguan', MONTHLY: 'Bulanan' };
export const UNIT: Record<string, string> = { DAILY: 'hari', WEEKLY: 'minggu', MONTHLY: 'bulan' };
export const TRANSMISSION: Record<string, string> = { MANUAL: 'Manual', AUTOMATIC: 'Otomatis' };
export const FUEL: Record<string, string> = { BENSIN: 'Bensin', SOLAR: 'Solar', LISTRIK: 'Listrik', HYBRID: 'Hybrid', LAINNYA: 'Lainnya' };
export const ROLE: Record<string, string> = { OWNER: 'Company Owner', ADMIN: 'Admin', FINANCE: 'Finance', OPERATOR: 'Operator', VIEWER: 'Viewer' };
export const ID_TYPES = ['KTP', 'SIM', 'PASPOR', 'NPWP', 'LAINNYA'];
