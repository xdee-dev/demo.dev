import { Router, type Request } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { withTenant } from '../db/tenant.js';
import { fileAttachments } from '../db/schema.js';
import { config } from '../config.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, zUuid } from '../lib/http.js';
import { can } from '../auth/middleware.js';
import type { Permission } from '../auth/permissions.js';
import { audit } from '../lib/audit.js';

export const filesRouter = Router();

const KINDS: Record<string, { write: Permission; read: Permission[]; allowPdf: boolean; maxPx: number }> = {
  VEHICLE_PHOTO: { write: 'vehicle.manage', read: ['vehicle.view'], allowPdf: false, maxPx: 1280 },
  CUSTOMER_DOC: { write: 'customer.manage', read: ['customer.view'], allowPdf: true, maxPx: 1800 },
  PAYMENT_PROOF: { write: 'payment.manage', read: ['payment.view'], allowPdf: true, maxPx: 1800 },
  EXPENSE_PROOF: { write: 'expense.manage', read: ['expense.view'], allowPdf: true, maxPx: 1800 },
  INCOME_PROOF: { write: 'income.manage', read: ['income.view'], allowPdf: true, maxPx: 1800 },
  MAINTENANCE_PROOF: { write: 'maintenance.manage', read: ['maintenance.view'], allowPdf: true, maxPx: 1800 },
  COMPANY_LOGO: { write: 'settings.manage', read: [], allowPdf: false, maxPx: 600 }, // logo readable by any member (printed documents)
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

/** Validates by magic bytes (not by extension or client MIME), re-encodes images (strips EXIF/metadata). */
async function sanitizeFile(buf: Buffer, allowPdf: boolean, maxPx: number): Promise<{ data: Buffer; mime: string; ext: string }> {
  const ft = await fileTypeFromBuffer(buf);
  if (!ft) throw badRequest('Tipe file tidak dikenali');
  if (['image/jpeg', 'image/png', 'image/webp'].includes(ft.mime)) {
    try {
      const img = sharp(buf, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true });
      if (ft.mime === 'image/png') return { data: await img.png({ compressionLevel: 9 }).toBuffer(), mime: 'image/png', ext: 'png' };
      return { data: await img.webp({ quality: 80 }).toBuffer(), mime: 'image/webp', ext: 'webp' };
    } catch {
      throw badRequest('File gambar rusak atau tidak valid');
    }
  }
  if (ft.mime === 'application/pdf' && allowPdf) {
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw badRequest('File PDF tidak valid');
    return { data: buf, mime: 'application/pdf', ext: 'pdf' };
  }
  throw badRequest(allowPdf ? 'Hanya file JPG, PNG, WEBP, atau PDF yang diizinkan' : 'Hanya file gambar JPG, PNG, atau WEBP yang diizinkan');
}

filesRouter.post('/files', upload.single('file'), async (req, res) => {
  const meta = parse(z.object({
    kind: z.enum(Object.keys(KINDS) as [string, ...string[]]),
    entityType: z.string().max(40).optional(),
    entityId: z.uuid().optional(),
  }), req.body);
  const rule = KINDS[meta.kind];
  if (!can(req, rule.write)) throw forbidden();
  if (!req.file) throw badRequest('File wajib diunggah');
  const { data, mime, ext } = await sanitizeFile(req.file.buffer, rule.allowPdf, rule.maxPx);
  const { companyId } = req.ctx!;
  const key = path.posix.join(companyId, `${crypto.randomUUID()}.${ext}`);
  const abs = path.join(config.storageDir, key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data, { mode: 0o640 });
  const originalName = path.basename(req.file.originalname).replace(/[^\w.\- ()]/g, '_').slice(0, 150) || `file.${ext}`;
  const row = await withTenant(companyId, async (tx) => {
    const [r] = await tx.insert(fileAttachments).values({
      companyId, kind: meta.kind, entityType: meta.entityType, entityId: meta.entityId,
      originalName, mimeType: mime, sizeBytes: data.length, storageKey: key, createdBy: req.user!.id,
    }).returning();
    await audit(tx, req, { action: 'file.upload', entityType: 'file', entityId: r.id, summary: `${meta.kind}: ${originalName}` });
    return r;
  });
  res.status(201).json({ id: row.id, kind: row.kind, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, createdAt: row.createdAt });
});

function canRead(req: Request, kind: string) {
  const rule = KINDS[kind];
  if (!rule) return false;
  if (rule.read.length === 0) return true;
  return rule.read.some((p) => can(req, p));
}

filesRouter.get('/files/:id', async (req, res) => {
  const id = parse(zUuid, req.params.id);
  const { companyId } = req.ctx!;
  // RLS + explicit company filter: a file id from another company is simply "not found".
  const row = await withTenant(companyId, (tx) => tx.query.fileAttachments.findFirst({ where: and(eq(fileAttachments.id, id), eq(fileAttachments.companyId, companyId)) }));
  if (!row) throw notFound('File');
  if (!canRead(req, row.kind)) throw forbidden();
  const abs = path.resolve(config.storageDir, row.storageKey);
  if (!abs.startsWith(config.storageDir + path.sep)) throw notFound('File');
  try { await fs.access(abs); } catch { throw notFound('File'); }
  res.setHeader('Content-Type', row.mimeType);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(row.originalName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(abs).pipe(res);
});

filesRouter.get('/attachments', async (req, res) => {
  const q = parse(z.object({ entityType: z.string().max(40), entityId: z.uuid() }), req.query);
  const { companyId } = req.ctx!;
  const rows = await withTenant(companyId, (tx) => tx.select({
    id: fileAttachments.id, kind: fileAttachments.kind, originalName: fileAttachments.originalName, mimeType: fileAttachments.mimeType,
    sizeBytes: fileAttachments.sizeBytes, createdAt: fileAttachments.createdAt,
  }).from(fileAttachments).where(and(eq(fileAttachments.companyId, companyId), eq(fileAttachments.entityType, q.entityType), eq(fileAttachments.entityId, q.entityId)))
    .orderBy(desc(fileAttachments.createdAt)));
  res.json(rows.filter((r) => canRead(req, r.kind)));
});
