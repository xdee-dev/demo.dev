import type { Request } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { customers, drivers, vehicleRates, vehicles } from '../db/schema.js';
import { zDateTime, zMoney, zOptText, zOptUuid, zUuid } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { can } from '../auth/middleware.js';
import { quote, type Quote, type RentalType } from '../lib/pricing.js';
import type { CompanySettings } from '../lib/settings.js';
import { D } from '../lib/money.js';

/** Fields shared by reservations and rental transactions. */
export const bookingInput = z.object({
  customerId: zUuid,
  vehicleId: zUuid,
  driverId: zOptUuid,
  startAt: zDateTime,
  endAt: zDateTime,
  rentalType: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  withDriver: z.boolean().default(false),
  pickupLocation: zOptText(300),
  returnLocation: zOptText(300),
  unitPrice: zMoney.optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(10000).optional().nullable(),
  discount: zMoney.default('0'),
  extraCharges: zMoney.default('0'),
  extraChargesNote: zOptText(300),
  notes: zOptText(2000),
}).refine((v) => v.endAt > v.startAt, { message: 'Tanggal selesai harus setelah tanggal mulai', path: ['endAt'] });

export type BookingInput = z.infer<typeof bookingInput>;

export interface PricedBooking {
  quote: Quote;
  rate: string | null;
  dailyRate: string;
  customerSnapshot: Record<string, unknown>;
  vehicleSnapshot: Record<string, unknown>;
  overridden: boolean;
}

export function customerSnapshotOf(c: typeof customers.$inferSelect) {
  return {
    id: c.id, code: c.code, type: c.type, name: c.name, contactPerson: c.contactPerson, phone: c.phone, email: c.email,
    address: c.address, idType: c.idType, idNumber: c.idNumber,
  };
}

export function vehicleSnapshotOf(v: typeof vehicles.$inferSelect) {
  return {
    id: v.id, code: v.code, plateNumber: v.plateNumber, brand: v.brand, model: v.model, year: v.year, color: v.color,
    transmission: v.transmission, fuelType: v.fuelType, seats: v.seats,
  };
}

/**
 * Loads master data (scoped to the company), resolves the tariff, enforces the price-override
 * permission and computes all amounts on the server.
 */
export async function priceBooking(
  tx: Tx, req: Request, companyId: string, input: BookingInput, settings: CompanySettings,
  existing?: { vehicleId: string; rentalType: string; withDriver: boolean; unitPrice: string; quantity: number; discount: string; lateFee?: string; damageFee?: string; taxPercent?: string },
): Promise<PricedBooking> {
  const vehicle = await tx.query.vehicles.findFirst({ where: and(eq(vehicles.id, input.vehicleId), eq(vehicles.companyId, companyId)) });
  if (!vehicle) throw notFound('Kendaraan');
  if (vehicle.archivedAt || !vehicle.isActive) throw badRequest('Kendaraan tidak aktif');
  const customer = await tx.query.customers.findFirst({ where: and(eq(customers.id, input.customerId), eq(customers.companyId, companyId)) });
  if (!customer) throw notFound('Customer');
  if (customer.archivedAt) throw badRequest('Customer sudah diarsipkan');
  if (customer.status === 'BLACKLISTED') throw badRequest('Customer berstatus blacklist dan tidak dapat menyewa');
  if (input.driverId) {
    const driver = await tx.query.drivers.findFirst({ where: and(eq(drivers.id, input.driverId), eq(drivers.companyId, companyId)) });
    if (!driver || driver.archivedAt) throw notFound('Sopir');
    if (!input.withDriver) throw badRequest('Sopir hanya dapat dipilih untuk layanan dengan sopir');
  }

  const rates = await tx.select().from(vehicleRates).where(eq(vehicleRates.vehicleId, vehicle.id));
  const rate = rates.find((r) => r.rentalType === input.rentalType && r.withDriver === input.withDriver)?.price ?? null;
  const dailyRate = rates.find((r) => r.rentalType === 'DAILY' && r.withDriver === input.withDriver)?.price ?? null;

  const sameTerms = existing && existing.vehicleId === input.vehicleId && existing.rentalType === input.rentalType && existing.withDriver === input.withDriver;
  // Price the booking would get without any manual change
  const baselinePrice = sameTerms ? existing!.unitPrice : rate;
  const unitPrice = input.unitPrice ?? baselinePrice;
  if (unitPrice === null || unitPrice === undefined) {
    throw badRequest('Tarif kendaraan untuk jenis rental/layanan ini belum diatur. Atur tarif di menu Tarif Rental atau isi harga manual (perlu izin).');
  }

  const auto = quote({ startAt: input.startAt, endAt: input.endAt, rentalType: input.rentalType as RentalType, unitPrice, graceMinutes: settings.graceMinutes, decimals: settings.moneyDecimals });
  const priceChanged = baselinePrice === null || !D(unitPrice).eq(D(baselinePrice));
  const qtyChanged = !!input.quantity && input.quantity !== auto.autoQuantity && !(sameTerms && input.quantity === existing!.quantity);
  const discountChanged = !D(input.discount).eq(D(existing?.discount ?? '0'));
  const overridden = priceChanged || qtyChanged || (discountChanged && D(input.discount).gt(0));
  if (overridden && !can(req, 'rental.price_override')) {
    throw forbidden('Anda tidak memiliki izin mengubah harga, kuantitas, atau diskon di luar tarif');
  }

  const q = quote({
    startAt: input.startAt, endAt: input.endAt, rentalType: input.rentalType as RentalType, unitPrice,
    quantity: input.quantity ?? null,
    discount: input.discount, extraCharges: input.extraCharges,
    lateFee: existing?.lateFee, damageFee: existing?.damageFee,
    taxPercent: existing?.taxPercent ?? settings.taxPercent, graceMinutes: settings.graceMinutes, decimals: settings.moneyDecimals,
  });

  return {
    quote: q,
    rate,
    dailyRate: dailyRate ?? (input.rentalType === 'DAILY' ? q.unitPrice : '0'),
    customerSnapshot: customerSnapshotOf(customer),
    vehicleSnapshot: vehicleSnapshotOf(vehicle),
    overridden,
  };
}
