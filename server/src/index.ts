import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { pool } from './db/client.js';

/**
 * Row-Level Security does not apply to superusers or roles with BYPASSRLS. Tenant isolation is
 * still enforced by the application, but the database safety net would be gone — so production
 * refuses to start with such a role (see docs/DATABASE.md).
 */
async function checkDbRole() {
  const r = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }>(
    'select rolsuper, rolbypassrls, current_user from pg_roles where rolname = current_user');
  const role = r.rows[0];
  if (role && (role.rolsuper || role.rolbypassrls)) {
    const msg = `Database user "${role.current_user}" is a superuser/BYPASSRLS role: PostgreSQL Row-Level Security will NOT protect tenant data. Create a dedicated non-superuser role (docs/DATABASE.md).`;
    if (config.isProd && process.env.ALLOW_RLS_BYPASS_ROLE !== 'true') throw new Error(msg);
    console.warn(`⚠ ${msg}`);
  }
}

async function main() {
  await checkDbRole();
  if (process.env.MIGRATE_ON_START !== 'false') await runMigrations();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`✔ Rental Management System API listening on http://localhost:${config.port} (${config.env})`);
  });
  const shutdown = () => { server.close(() => pool.end().then(() => process.exit(0))); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
