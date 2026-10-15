import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { cashAccounts, companies, expenseCategories, rolePermissions } from '../db/schema.js';
import { DEFAULT_ROLE_PERMISSIONS, ROLES } from '../auth/permissions.js';
import { defaultSettings, saveSettings } from '../lib/settings.js';

export const DEFAULT_EXPENSE_CATEGORIES: [string, string][] = [
  ['BBM', 'BBM'],
  ['TOL_PARKIR', 'Tol dan parkir'],
  ['SERVIS', 'Servis kendaraan'],
  ['SUKU_CADANG', 'Suku cadang'],
  ['SOPIR', 'Gaji atau fee sopir'],
  ['ASURANSI', 'Asuransi'],
  ['PAJAK_KENDARAAN', 'Pajak kendaraan'],
  ['KEBERSIHAN', 'Kebersihan kendaraan'],
  ['ADMINISTRASI', 'Administrasi'],
  ['LAINNYA', 'Biaya operasional lainnya'],
];

/** Default data every new company starts with. Must run inside a tx with the tenant set. */
export async function bootstrapCompany(tx: Tx, companyId: string, userId: string | null) {
  await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
  await saveSettings(tx, companyId, defaultSettings(), userId);
  const rows = ROLES.flatMap((role) => DEFAULT_ROLE_PERMISSIONS[role].map((permission) => ({ companyId, role, permission })));
  await tx.insert(rolePermissions).values(rows).onConflictDoNothing();
  await tx.insert(expenseCategories)
    .values(DEFAULT_EXPENSE_CATEGORIES.map(([code, name]) => ({ companyId, code, name })))
    .onConflictDoNothing();
  await tx.insert(cashAccounts).values({ companyId, name: 'Kas Tunai', type: 'CASH' }).onConflictDoNothing();
}

export async function companySnapshot(tx: Tx, companyId: string) {
  const c = await tx.query.companies.findFirst({ where: eq(companies.id, companyId) });
  if (!c) throw new Error('company missing');
  return {
    name: c.name, address: c.address, city: c.city, phone: c.phone, email: c.email, website: c.website, npwp: c.npwp,
    bankAccounts: c.bankAccounts, logoFileId: c.logoFileId, timezone: c.timezone,
  };
}
