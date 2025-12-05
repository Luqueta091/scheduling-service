import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const DEFAULT_KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(plain, salt, DEFAULT_KEYLEN);
  return `${salt}:${Buffer.from(derivedKey as Buffer).toString('hex')}`;
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  const [salt, hash] = hashed.split(':');
  if (!salt || !hash) return false;
  const derivedKey = await scrypt(plain, salt, DEFAULT_KEYLEN);
  const candidate = Buffer.from(derivedKey as Buffer).toString('hex');
  return timingSafeEqual(Buffer.from(candidate, 'utf-8'), Buffer.from(hash, 'utf-8'));
}
