import { randomUUID } from 'node:crypto';

type SharedModule = typeof import('../../packages/shared/src/index');

type StaffRole = 'barbeiro' | 'admin';

export async function seedStaffUser({
  email,
  password,
  role
}: {
  email: string;
  password: string;
  role: StaffRole;
}): Promise<void> {
  const shared = (await import('@barbershop/shared')) as unknown as SharedModule;
  const { hashPassword } = await import('../../src/infrastructure/security/password');
  const passwordHash = await hashPassword(password);

  await shared.getDb().query(
    `INSERT INTO users (id, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [randomUUID(), email.toLowerCase(), passwordHash, role]
  );
}
