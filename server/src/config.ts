import path from 'node:path';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const env = process.env.NODE_ENV ?? 'development';

export const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', env === 'test' ? process.env.TEST_DATABASE_URL : undefined),
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  /** Cookies get the Secure flag in production (HTTPS required). */
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : env === 'production',
  trustProxy: process.env.TRUST_PROXY ?? (env === 'production' ? '1' : 'loopback'),
  storageDir: path.resolve(process.env.STORAGE_DIR ?? './storage'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 5),
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    secure: process.env.SMTP_SECURE === 'true',
    from: process.env.MAIL_FROM ?? 'Rental Management System <no-reply@localhost>',
  },
  /** Built frontend served by the API in production (single deployable). */
  webDist: process.env.WEB_DIST ?? path.resolve(import.meta.dirname, '../../web/dist'),
};
