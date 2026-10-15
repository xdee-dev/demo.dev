import pg from 'pg';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/** Fresh schema for every test run: drop everything in the test DB, then apply migrations. */
export default async function setup() {
  const url = process.env.DATABASE_URL!;
  if (!/test/i.test(url)) throw new Error(`Refusing to reset a non-test database: ${url}`);
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(import.meta.dirname, '../drizzle') });
  await pool.end();
}
