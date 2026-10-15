/**
 * Database schema (PostgreSQL) — Rental Management System.
 *
 * Multi-tenant model: shared database, shared schema, every operational table carries
 * `company_id`. Isolation is enforced twice:
 *   1. Application layer — every query runs inside `withTenant()` and filters by company_id.
 *   2. Database layer — Row-Level Security (FORCE RLS) policies keyed on the
 *      transaction-local setting `app.company_id` (see drizzle/0001_rls_constraints.sql).
 *
 * Money columns are NUMERIC(18,2); never floating point.
 */
import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, uuid, text, boolean, timestamp, integer, numeric, jsonb, date, index,
  uniqueIndex, primaryKey, check, customType, bigserial, smallint,
} from 'drizzle-orm/pg-core';

/* ----------------------------------------------------------------- helpers */

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
/** tstzrange is written/read as text, e.g. '[2026-01-01T00:00Z,2026-01-02T00:00Z)' */
export const tstzrange = customType<{ data: string }>({ dataType: () => 'tstzrange' });

const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const companyId = () => uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const createdBy = () => uuid('created_by').references(() => users.id);
const updatedBy = () => uuid('updated_by').references(() => users.id);

/* ------------------------------------------------------------------- enums */

export const membershipRole = pgEnum('membership_role', ['OWNER', 'ADMIN', 'FINANCE', 'OPERATOR', 'VIEWER']);
export const membershipStatus = pgEnum('membership_status', ['ACTIVE', 'DISABLED']);
export const customerType = pgEnum('customer_type', ['INDIVIDUAL', 'COMPANY']);
export const customerStatus = pgEnum('customer_status', ['ACTIVE', 'INACTIVE', 'BLACKLISTED']);
export const transmission = pgEnum('transmission', ['MANUAL', 'AUTOMATIC']);
export const fuelType = pgEnum('fuel_type', ['BENSIN', 'SOLAR', 'LISTRIK', 'HYBRID', 'LAINNYA']);
export const rentalType = pgEnum('rental_type', ['DAILY', 'WEEKLY', 'MONTHLY']);
export const reservationStatus = pgEnum('reservation_status', ['DRAFT', 'PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
export const rentalStatus = pgEnum('rental_status', ['SCHEDULED', 'ONGOING', 'RETURNED', 'COMPLETED', 'CANCELLED']);
export const blockSource = pgEnum('block_source', ['RESERVATION', 'RENTAL', 'MAINTENANCE']);
export const paymentKind = pgEnum('payment_kind', ['PAYMENT', 'REFUND', 'REVERSAL']);
export const postingStatus = pgEnum('posting_status', ['POSTED', 'VOID']);
export const maintenanceStatus = pgEnum('maintenance_status', ['SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const cashAccountType = pgEnum('cash_account_type', ['CASH', 'BANK', 'EWALLET']);
export const recordStatus = pgEnum('record_status', ['ACTIVE', 'INACTIVE']);
export const importEntity = pgEnum('import_entity', ['CUSTOMER', 'VEHICLE']);
export const importStatus = pgEnum('import_status', ['PREVIEW', 'COMPLETED', 'FAILED']);

/* ------------------------------------------------- platform (non-tenant) */

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  address: text('address'),
  city: text('city'),
  phone: text('phone'),
  email: text('email'),
  website: text('website'),
  npwp: text('npwp'),
  /** [{ bank, accountNumber, accountHolder }] */
  bankAccounts: jsonb('bank_accounts').$type<{ bank: string; accountNumber: string; accountHolder: string }[]>().notNull().default([]),
  logoFileId: uuid('logo_file_id'),
  timezone: text('timezone').notNull().default('Asia/Jakarta'),
  currency: text('currency').notNull().default('IDR'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable('users', {
  id: id(),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  csrfToken: text('csrf_token').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const passwordTokens = pgTable('password_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  purpose: text('purpose').notNull(), // RESET | INVITE
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('password_tokens_user_idx').on(t.userId)]);

export const companyMemberships = pgTable('company_memberships', {
  id: id(),
  companyId: companyId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: membershipRole('role').notNull(),
  status: membershipStatus('status').notNull().default('ACTIVE'),
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('company_memberships_company_user_uq').on(t.companyId, t.userId),
  index('company_memberships_user_idx').on(t.userId),
]);

/* ------------------------------------------------------ tenant: settings */

export const rolePermissions = pgTable('role_permissions', {
  companyId: companyId(),
  role: membershipRole('role').notNull(),
  permission: text('permission').notNull(),
}, (t) => [primaryKey({ columns: [t.companyId, t.role, t.permission] })]);

export const companySettings = pgTable('company_settings', {
  companyId: uuid('company_id').primaryKey().references(() => companies.id),
  data: jsonb('data').notNull().default({}),
  updatedAt: updatedAt(),
  updatedBy: updatedBy(),
});

export const documentSequences = pgTable('document_sequences', {
  companyId: companyId(),
  docType: text('doc_type').notNull(),
  periodKey: text('period_key').notNull(),
  lastValue: integer('last_value').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.companyId, t.docType, t.periodKey] })]);

export const fileAttachments = pgTable('file_attachments', {
  id: id(),
  companyId: companyId(),
  kind: text('kind').notNull(), // VEHICLE_PHOTO | CUSTOMER_DOC | PAYMENT_PROOF | EXPENSE_PROOF | INCOME_PROOF | MAINTENANCE_PROOF | COMPANY_LOGO
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  createdBy: createdBy(),
  createdAt: createdAt(),
}, (t) => [index('file_attachments_entity_idx').on(t.companyId, t.entityType, t.entityId)]);

export const cashAccounts = pgTable('cash_accounts', {
  id: id(),
  companyId: companyId(),
  name: text('name').notNull(),
  type: cashAccountType('type').notNull().default('CASH'),
  bankName: text('bank_name'),
  accountNumber: text('account_number'),
  accountHolder: text('account_holder'),
  openingBalance: money('opening_balance').notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('cash_accounts_company_name_uq').on(t.companyId, t.name)]);

export const expenseCategories = pgTable('expense_categories', {
  id: id(),
  companyId: companyId(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('expense_categories_company_code_uq').on(t.companyId, t.code)]);

/* --------------------------------------------------- tenant: master data */

export const customers = pgTable('customers', {
  id: id(),
  companyId: companyId(),
  code: text('code').notNull(),
  type: customerType('type').notNull().default('INDIVIDUAL'),
  name: text('name').notNull(),
  contactPerson: text('contact_person'),
  phone: text('phone').notNull(),
  phoneNormalized: text('phone_normalized').notNull(),
  email: text('email'),
  address: text('address'),
  idType: text('id_type'),
  idNumber: text('id_number'),
  notes: text('notes'),
  status: customerStatus('status').notNull().default('ACTIVE'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: createdBy(),
  updatedBy: updatedBy(),
}, (t) => [
  uniqueIndex('customers_company_code_uq').on(t.companyId, t.code),
  index('customers_company_phone_idx').on(t.companyId, t.phoneNormalized),
  index('customers_company_idnum_idx').on(t.companyId, t.idNumber),
  index('customers_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
]);

export const vehicles = pgTable('vehicles', {
  id: id(),
  companyId: companyId(),
  code: text('code').notNull(),
  plateNumber: text('plate_number').notNull(),
  plateNormalized: text('plate_normalized').notNull(),
  brand: text('brand').notNull(),
  model: text('model').notNull(),
  year: smallint('year'),
  color: text('color'),
  transmission: transmission('transmission').notNull().default('MANUAL'),
  fuelType: fuelType('fuel_type').notNull().default('BENSIN'),
  seats: smallint('seats'),
  chassisNumber: text('chassis_number'),
  engineNumber: text('engine_number'),
  purchaseDate: date('purchase_date'),
  purchasePrice: money('purchase_price'),
  currentKm: integer('current_km'),
  isActive: boolean('is_active').notNull().default(true),
  photoFileId: uuid('photo_file_id'),
  notes: text('notes'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: createdBy(),
  updatedBy: updatedBy(),
}, (t) => [
  uniqueIndex('vehicles_company_code_uq').on(t.companyId, t.code),
  uniqueIndex('vehicles_company_plate_uq').on(t.companyId, t.plateNormalized),
  check('vehicles_year_ck', sql`${t.year} IS NULL OR (${t.year} BETWEEN 1950 AND 2100)`),
  check('vehicles_seats_ck', sql`${t.seats} IS NULL OR (${t.seats} BETWEEN 1 AND 100)`),
]);

export const vehicleRates = pgTable('vehicle_rates', {
  id: id(),
  companyId: companyId(),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
  rentalType: rentalType('rental_type').notNull(),
  withDriver: boolean('with_driver').notNull(),
  price: money('price').notNull(),
  updatedAt: updatedAt(),
  updatedBy: updatedBy(),
}, (t) => [
  uniqueIndex('vehicle_rates_uq').on(t.vehicleId, t.rentalType, t.withDriver),
  index('vehicle_rates_company_idx').on(t.companyId),
  check('vehicle_rates_price_ck', sql`${t.price} >= 0`),
]);

export const drivers = pgTable('drivers', {
  id: id(),
  companyId: companyId(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  licenseNumber: text('license_number'),
  dailyFee: money('daily_fee').notNull().default('0'),
  status: recordStatus('status').notNull().default('ACTIVE'),
  notes: text('notes'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('drivers_company_code_uq').on(t.companyId, t.code)]);

/* ----------------------------------------------- tenant: operations */

/** Shared pricing columns used by reservations and rental transactions. */
const pricingColumns = () => ({
  rentalType: rentalType('rental_type').notNull(),
  withDriver: boolean('with_driver').notNull().default(false),
  unitPrice: money('unit_price').notNull(),
  quantity: integer('quantity').notNull(),
  subtotal: money('subtotal').notNull(),
  discount: money('discount').notNull().default('0'),
  extraCharges: money('extra_charges').notNull().default('0'),
  extraChargesNote: text('extra_charges_note'),
  taxPercent: numeric('tax_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  taxAmount: money('tax_amount').notNull().default('0'),
});

export const reservations = pgTable('reservations', {
  id: id(),
  companyId: companyId(),
  number: text('number').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  pickupLocation: text('pickup_location'),
  returnLocation: text('return_location'),
  ...pricingColumns(),
  total: money('total').notNull(),
  dpAmount: money('dp_amount').notNull().default('0'),
  notes: text('notes'),
  status: reservationStatus('status').notNull().default('DRAFT'),
  cancelledReason: text('cancelled_reason'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  rentalId: uuid('rental_id'),
  customerSnapshot: jsonb('customer_snapshot').notNull(),
  vehicleSnapshot: jsonb('vehicle_snapshot').notNull(),
  companySnapshot: jsonb('company_snapshot').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: createdBy(),
  updatedBy: updatedBy(),
}, (t) => [
  uniqueIndex('reservations_company_number_uq').on(t.companyId, t.number),
  index('reservations_company_start_idx').on(t.companyId, t.startAt),
  index('reservations_customer_idx').on(t.customerId),
  index('reservations_vehicle_idx').on(t.vehicleId),
  check('reservations_period_ck', sql`${t.endAt} > ${t.startAt}`),
  check('reservations_amounts_ck', sql`${t.subtotal} >= 0 AND ${t.discount} >= 0 AND ${t.extraCharges} >= 0 AND ${t.taxAmount} >= 0 AND ${t.dpAmount} >= 0 AND ${t.quantity} > 0`),
  check('reservations_total_ck', sql`${t.total} = ${t.subtotal} - ${t.discount} + ${t.extraCharges} + ${t.taxAmount} AND ${t.total} >= 0`),
]);

export const rentalTransactions = pgTable('rental_transactions', {
  id: id(),
  companyId: companyId(),
  number: text('number').notNull(),
  invoiceNumber: text('invoice_number').notNull(),
  contractNumber: text('contract_number').notNull(),
  reservationId: uuid('reservation_id').references(() => reservations.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  actualStartAt: timestamp('actual_start_at', { withTimezone: true }),
  actualEndAt: timestamp('actual_end_at', { withTimezone: true }),
  pickupLocation: text('pickup_location'),
  returnLocation: text('return_location'),
  ...pricingColumns(),
  /** Daily rate snapshot (same service type) used to compute late fees. */
  dailyRateSnapshot: money('daily_rate_snapshot').notNull().default('0'),
  lateFee: money('late_fee').notNull().default('0'),
  damageFee: money('damage_fee').notNull().default('0'),
  total: money('total').notNull(),
  cancellationFee: money('cancellation_fee').notNull().default('0'),
  status: rentalStatus('status').notNull().default('SCHEDULED'),
  cancelledReason: text('cancelled_reason'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  notes: text('notes'),
  customerSnapshot: jsonb('customer_snapshot').notNull(),
  vehicleSnapshot: jsonb('vehicle_snapshot').notNull(),
  companySnapshot: jsonb('company_snapshot').notNull(),
  idempotencyKey: text('idempotency_key'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: createdBy(),
  updatedBy: updatedBy(),
}, (t) => [
  uniqueIndex('rentals_company_number_uq').on(t.companyId, t.number),
  uniqueIndex('rentals_company_invoice_uq').on(t.companyId, t.invoiceNumber),
  uniqueIndex('rentals_company_contract_uq').on(t.companyId, t.contractNumber),
  uniqueIndex('rentals_reservation_uq').on(t.reservationId),
  uniqueIndex('rentals_company_idem_uq').on(t.companyId, t.idempotencyKey),
  index('rentals_company_start_idx').on(t.companyId, t.startAt),
  index('rentals_company_status_idx').on(t.companyId, t.status),
  index('rentals_customer_idx').on(t.customerId),
  index('rentals_vehicle_idx').on(t.vehicleId),
  check('rentals_period_ck', sql`${t.endAt} > ${t.startAt}`),
  check('rentals_amounts_ck', sql`${t.subtotal} >= 0 AND ${t.discount} >= 0 AND ${t.extraCharges} >= 0 AND ${t.taxAmount} >= 0 AND ${t.lateFee} >= 0 AND ${t.damageFee} >= 0 AND ${t.cancellationFee} >= 0 AND ${t.quantity} > 0`),
  check('rentals_total_ck', sql`${t.total} = ${t.subtotal} - ${t.discount} + ${t.extraCharges} + ${t.lateFee} + ${t.damageFee} + ${t.taxAmount} AND ${t.total} >= 0`),
]);

export const vehicleHandovers = pgTable('vehicle_handovers', {
  id: id(),
  companyId: companyId(),
  rentalId: uuid('rental_id').notNull().references(() => rentalTransactions.id),
  handedAt: timestamp('handed_at', { withTimezone: true }).notNull(),
  km: integer('km'),
  fuelLevel: text('fuel_level'),
  checklist: jsonb('checklist').notNull().default({}),
  conditionNotes: text('condition_notes'),
  staffName: text('staff_name'),
  receiverName: text('receiver_name'),
  createdBy: createdBy(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('vehicle_handovers_rental_uq').on(t.rentalId)]);

export const vehicleReturns = pgTable('vehicle_returns', {
  id: id(),
  companyId: companyId(),
  rentalId: uuid('rental_id').notNull().references(() => rentalTransactions.id),
  returnedAt: timestamp('returned_at', { withTimezone: true }).notNull(),
  km: integer('km'),
  fuelLevel: text('fuel_level'),
  checklist: jsonb('checklist').notNull().default({}),
  conditionNotes: text('condition_notes'),
  lateMinutes: integer('late_minutes').notNull().default(0),
  lateFee: money('late_fee').notNull().default('0'),
  damageFee: money('damage_fee').notNull().default('0'),
  damageNotes: text('damage_notes'),
  staffName: text('staff_name'),
  returnerName: text('returner_name'),
  createdBy: createdBy(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('vehicle_returns_rental_uq').on(t.rentalId)]);

/**
 * One row per thing that occupies a vehicle for a time range.
 * An EXCLUDE constraint (added in custom SQL migration) guarantees two *active* blocks of the
 * same vehicle never overlap — this is what makes double booking impossible, even under
 * concurrent requests.
 */
export const vehicleScheduleBlocks = pgTable('vehicle_schedule_blocks', {
  id: id(),
  companyId: companyId(),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
  sourceType: blockSource('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  period: tstzrange('period').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('vehicle_schedule_blocks_source_uq').on(t.sourceType, t.sourceId),
  index('vehicle_schedule_blocks_company_idx').on(t.companyId),
]);

/* --------------------------------------------------- tenant: finance */

export const payments = pgTable('payments', {
  id: id(),
  companyId: companyId(),
  number: text('number').notNull(),
  kind: paymentKind('kind').notNull().default('PAYMENT'),
  isDownPayment: boolean('is_down_payment').notNull().default(false),
  rentalId: uuid('rental_id').references(() => rentalTransactions.id),
  reservationId: uuid('reservation_id').references(() => reservations.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
  method: text('method').notNull(),
  cashAccountId: uuid('cash_account_id').references(() => cashAccounts.id),
  /** Signed: PAYMENT > 0, REFUND < 0, REVERSAL = -(reversed amount). */
  amount: money('amount').notNull(),
  reversesPaymentId: uuid('reverses_payment_id'),
  reference: text('reference'),
  notes: text('notes'),
  proofFileId: uuid('proof_file_id'),
  idempotencyKey: text('idempotency_key'),
  createdBy: createdBy(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('payments_company_number_uq').on(t.companyId, t.number),
  uniqueIndex('payments_company_idem_uq').on(t.companyId, t.idempotencyKey),
  uniqueIndex('payments_reverses_uq').on(t.reversesPaymentId),
  index('payments_company_paid_idx').on(t.companyId, t.paidAt),
  index('payments_rental_idx').on(t.rentalId),
  index('payments_reservation_idx').on(t.reservationId),
  index('payments_customer_idx').on(t.customerId),
  check('payments_target_ck', sql`${t.rentalId} IS NOT NULL OR ${t.reservationId} IS NOT NULL`),
  check('payments_sign_ck', sql`(${t.kind} = 'PAYMENT' AND ${t.amount} > 0) OR (${t.kind} = 'REFUND' AND ${t.amount} < 0) OR (${t.kind} = 'REVERSAL' AND ${t.amount} <> 0 AND ${t.reversesPaymentId} IS NOT NULL)`),
]);

const postingColumns = () => ({
  status: postingStatus('status').notNull().default('POSTED'),
  voidReason: text('void_reason'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by').references(() => users.id),
  idempotencyKey: text('idempotency_key'),
});

export const expenses = pgTable('expenses', {
  id: id(),
  companyId: companyId(),
  number: text('number').notNull(),
  expenseDate: date('expense_date').notNull(),
  categoryId: uuid('category_id').notNull().references(() => expenseCategories.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  rentalId: uuid('rental_id').references(() => rentalTransactions.id),
  maintenanceId: uuid('maintenance_id'),
  description: text('description').notNull(),
  amount: money('amount').notNull(),
  method: text('method').notNull(),
  cashAccountId: uuid('cash_account_id').references(() => cashAccounts.id),
  proofFileId: uuid('proof_file_id'),
  notes: text('notes'),
  ...postingColumns(),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  updatedBy: updatedBy(),
}, (t) => [
  uniqueIndex('expenses_company_number_uq').on(t.companyId, t.number),
  uniqueIndex('expenses_company_idem_uq').on(t.companyId, t.idempotencyKey),
  uniqueIndex('expenses_maintenance_uq').on(t.maintenanceId),
  index('expenses_company_date_idx').on(t.companyId, t.expenseDate),
  index('expenses_vehicle_idx').on(t.vehicleId),
  check('expenses_amount_ck', sql`${t.amount} > 0`),
]);

export const otherIncomes = pgTable('other_incomes', {
  id: id(),
  companyId: companyId(),
  number: text('number').notNull(),
  incomeDate: date('income_date').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  amount: money('amount').notNull(),
  method: text('method').notNull(),
  cashAccountId: uuid('cash_account_id').references(() => cashAccounts.id),
  proofFileId: uuid('proof_file_id'),
  notes: text('notes'),
  ...postingColumns(),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('other_incomes_company_number_uq').on(t.companyId, t.number),
  uniqueIndex('other_incomes_company_idem_uq').on(t.companyId, t.idempotencyKey),
  index('other_incomes_company_date_idx').on(t.companyId, t.incomeDate),
  check('other_incomes_amount_ck', sql`${t.amount} > 0`),
]);

/* ---------------------------------------------- tenant: maintenance */

export const maintenanceRecords = pgTable('maintenance_records', {
  id: id(),
  companyId: companyId(),
  number: text('number').notNull(),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  status: maintenanceStatus('status').notNull().default('SCHEDULED'),
  serviceType: text('service_type').notNull(),
  km: integer('km'),
  workshop: text('workshop'),
  cost: money('cost').notNull().default('0'),
  nextServiceDate: date('next_service_date'),
  nextServiceKm: integer('next_service_km'),
  notes: text('notes'),
  proofFileId: uuid('proof_file_id'),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  updatedBy: updatedBy(),
}, (t) => [
  uniqueIndex('maintenance_company_number_uq').on(t.companyId, t.number),
  index('maintenance_vehicle_idx').on(t.vehicleId),
  index('maintenance_company_start_idx').on(t.companyId, t.startAt),
  check('maintenance_period_ck', sql`${t.endAt} IS NULL OR ${t.endAt} > ${t.startAt}`),
  check('maintenance_cost_ck', sql`${t.cost} >= 0`),
]);

/* ----------------------------------------------------- tenant: misc */

export const importJobs = pgTable('import_jobs', {
  id: id(),
  companyId: companyId(),
  entity: importEntity('entity').notNull(),
  fileName: text('file_name').notNull(),
  status: importStatus('status').notNull().default('PREVIEW'),
  headers: jsonb('headers').$type<string[]>().notNull(),
  rows: jsonb('rows').$type<string[][]>().notNull(),
  mapping: jsonb('mapping'),
  duplicateMode: text('duplicate_mode'),
  result: jsonb('result'),
  createdBy: createdBy(),
  createdAt: createdAt(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [index('import_jobs_company_idx').on(t.companyId, t.createdAt)]);

export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  companyId: uuid('company_id').references(() => companies.id),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  summary: text('summary'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
}, (t) => [
  index('audit_logs_company_created_idx').on(t.companyId, t.createdAt),
  index('audit_logs_entity_idx').on(t.companyId, t.entityType, t.entityId),
]);
