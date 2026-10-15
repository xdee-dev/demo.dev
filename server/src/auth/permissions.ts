export const PERMISSIONS = {
  'dashboard.view': 'Lihat dashboard',
  'customer.view': 'Lihat customer',
  'customer.manage': 'Tambah/ubah/arsipkan customer',
  'customer.import': 'Impor customer',
  'vehicle.view': 'Lihat kendaraan & tarif',
  'vehicle.manage': 'Tambah/ubah/arsipkan kendaraan',
  'vehicle.import': 'Impor kendaraan',
  'rate.manage': 'Ubah tarif rental',
  'driver.view': 'Lihat sopir',
  'driver.manage': 'Kelola sopir',
  'reservation.view': 'Lihat reservasi & kalender',
  'reservation.manage': 'Buat/ubah/batalkan reservasi',
  'rental.view': 'Lihat transaksi rental',
  'rental.manage': 'Buat/ubah transaksi rental',
  'rental.price_override': 'Ubah harga/kuantitas di luar tarif',
  'rental.cancel': 'Batalkan transaksi rental',
  'handover.manage': 'Serah terima & pengembalian kendaraan',
  'payment.view': 'Lihat pembayaran',
  'payment.manage': 'Catat pembayaran & refund',
  'payment.reverse': 'Batalkan (reversal) pembayaran',
  'income.view': 'Lihat pemasukan lain',
  'income.manage': 'Catat/void pemasukan lain',
  'expense.view': 'Lihat pengeluaran',
  'expense.manage': 'Catat/ubah pengeluaran',
  'expense.void': 'Void pengeluaran',
  'maintenance.view': 'Lihat perawatan',
  'maintenance.manage': 'Kelola perawatan',
  'report.operational': 'Laporan operasional',
  'report.financial': 'Laporan keuangan',
  'data.export': 'Ekspor data (XLSX/CSV/PDF)',
  'settings.manage': 'Ubah profil & pengaturan perusahaan',
  'users.manage': 'Kelola pengguna & role',
  'audit.view': 'Lihat audit log',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export type Role = 'OWNER' | 'ADMIN' | 'FINANCE' | 'OPERATOR' | 'VIEWER';
export const ROLES: Role[] = ['OWNER', 'ADMIN', 'FINANCE', 'OPERATOR', 'VIEWER'];

const viewPerms: Permission[] = [
  'dashboard.view', 'customer.view', 'vehicle.view', 'driver.view', 'reservation.view', 'rental.view',
  'payment.view', 'income.view', 'expense.view', 'maintenance.view',
];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS.filter((p) => !['users.manage', 'settings.manage', 'audit.view', 'payment.reverse', 'expense.void'].includes(p)),
  FINANCE: [
    ...viewPerms, 'payment.manage', 'payment.reverse', 'income.manage', 'expense.manage', 'expense.void',
    'report.operational', 'report.financial', 'data.export',
  ],
  OPERATOR: [
    'dashboard.view', 'customer.view', 'customer.manage', 'vehicle.view', 'vehicle.manage', 'driver.view', 'driver.manage',
    'reservation.view', 'reservation.manage', 'rental.view', 'rental.manage', 'handover.manage', 'payment.view',
    'maintenance.view', 'maintenance.manage', 'report.operational',
  ],
  VIEWER: [...viewPerms, 'report.operational', 'report.financial'],
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Company Owner', ADMIN: 'Admin', FINANCE: 'Finance', OPERATOR: 'Operator', VIEWER: 'Viewer',
};
