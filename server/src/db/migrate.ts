import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '../../drizzle') });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => { console.log('✔ Migrations applied'); return pool.end(); })
    .catch((e) => { console.error('✖ Migration failed:', e); process.exit(1); });
}
