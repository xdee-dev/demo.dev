import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { AppError, fromPgError } from './lib/errors.js';
import { loadSession, requireAuth, csrfProtection, requireCompany, requireSuperAdmin } from './auth/middleware.js';
import { authRouter } from './routes/auth.js';
import { companyRouter } from './routes/company.js';
import { adminRouter } from './routes/admin.js';
import { apiRouter } from './routes/index.js';

const PG_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}(:\d{2})?$/;

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  // Raw SQL rows return timestamptz as 'YYYY-MM-DD HH:MM:SS+00' — normalize to ISO-8601 for every client.
  app.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'string' && PG_TS.test(value) ? new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString() : value);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'blob:'],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'connect-src': ["'self'"],
        // Only force HTTPS when the deployment actually runs behind HTTPS (COOKIE_SECURE / production default).
        'upgrade-insecure-requests': config.secureCookies ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.secureCookies ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

  const api = express.Router();
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(loadSession);
  api.use(csrfProtection);
  api.use('/auth', authRouter);
  api.use('/admin', requireSuperAdmin, adminRouter);
  // Everything below requires an authenticated user AND verified membership of the active company.
  api.use(requireAuth, requireCompany);
  api.use(companyRouter);
  api.use(apiRouter);
  app.use('/api', api);
  app.use('/api', (_req, res) => { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' } }); });

  // Production: serve the built SPA from the same origin.
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '7d', setHeaders: (res, p) => {
      if (p.endsWith('sw.js') || p.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
    } }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let appErr: AppError | null = err instanceof AppError ? err : fromPgError(err);
  const anyErr = err as { type?: string; status?: number; code?: string };
  if (!appErr && anyErr?.type === 'entity.parse.failed') appErr = new AppError(400, 'BAD_JSON', 'Format JSON tidak valid');
  if (!appErr && anyErr?.type === 'entity.too.large') appErr = new AppError(413, 'TOO_LARGE', 'Data terlalu besar');
  if (!appErr && anyErr?.code === 'LIMIT_FILE_SIZE') appErr = new AppError(413, 'FILE_TOO_LARGE', `Ukuran file maksimal ${config.maxUploadMb} MB`);
  if (!appErr) {
    // Unknown error: log details server-side, return a generic message (no stack / SQL leaks).
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    appErr = new AppError(500, 'INTERNAL', 'Terjadi kesalahan pada server. Silakan coba lagi.');
  }
  res.status(appErr.status).json({ error: { code: appErr.code, message: appErr.message, details: appErr.details } });
}
