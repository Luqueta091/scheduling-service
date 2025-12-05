import type { PoolClient } from 'pg';

import { getDb } from '@barbershop/shared';

export type StaffRole = 'barbeiro' | 'admin';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: StaffRole;
}

export interface CreateUserInput {
  id: string;
  email: string;
  passwordHash: string;
  role: StaffRole;
}

export class UserRepository {
  async findByEmail(email: string, client?: PoolClient): Promise<UserRecord | null> {
    const executor = client ?? getDb();
    const normalizedEmail = email.toLowerCase();
    const result = await executor.query(
      `SELECT id, email, password_hash AS "passwordHash", role
         FROM users
        WHERE email = $1`,
      [normalizedEmail]
    );

    if (result.rowCount === 0) return null;
    return result.rows[0] as UserRecord;
  }

  async findById(id: string, client?: PoolClient): Promise<UserRecord | null> {
    const executor = client ?? getDb();
    const result = await executor.query(
      `SELECT id, email, password_hash AS "passwordHash", role
         FROM users
        WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) return null;
    return result.rows[0] as UserRecord;
  }

  async create(user: CreateUserInput, client: PoolClient): Promise<UserRecord> {
    const result = await client.query(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, password_hash AS "passwordHash", role`,
      [user.id, user.email.toLowerCase(), user.passwordHash, user.role]
    );

    return result.rows[0] as UserRecord;
  }
}
