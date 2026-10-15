import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

// Load ../.env (if present) and point the app at the TEST database.
const envFile = path.resolve(import.meta.dirname, '../.env');
const fileEnv: Record<string, string> = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) fileEnv[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const testDb = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL;
if (!testDb) throw new Error('TEST_DATABASE_URL belum diatur (lihat .env.example)');

// globalSetup runs in the main process: expose the test DB there too
process.env.DATABASE_URL = testDb;

export default defineConfig({
  test: {
    env: { ...fileEnv, NODE_ENV: 'test', DATABASE_URL: testDb, STORAGE_DIR: path.resolve(import.meta.dirname, '.test-storage'), SMTP_HOST: '' },
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
