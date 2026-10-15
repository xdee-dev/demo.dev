import { hash, verify } from '@node-rs/argon2';
import crypto from 'node:crypto';

// Argon2id, OWASP-recommended parameters (19 MiB, 2 iterations, 1 lane).
const OPTS = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTS);

export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (!stored) {
    // Constant-ish time: still do the work so timing does not reveal unknown accounts.
    await hash(password, OPTS);
    return false;
  }
  try { return await verify(stored, password); } catch { return false; }
}

export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 10) return 'Password minimal 10 karakter';
  if (pw.length > 128) return 'Password maksimal 128 karakter';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Password harus mengandung huruf besar, huruf kecil, dan angka';
  return null;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
