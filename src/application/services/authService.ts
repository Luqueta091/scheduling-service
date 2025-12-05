import { randomUUID } from 'node:crypto';

import { ConflictError, UnauthorizedError, config } from '@barbershop/shared';

import { signJwt, verifyJwt, type JwtPayload } from '../../infrastructure/security/jwt';
import { hashPassword, verifyPassword } from '../../infrastructure/security/password';
import {
  UserRepository,
  type StaffRole,
  type UserRecord
} from '../../repository/UserRepository';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: StaffRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

export class AuthService {
  constructor(private readonly repository: UserRepository) {}

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.repository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedError('Invalid credentials');
    }

    return this.generateTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = this.verifyToken(refreshToken, 'refresh');
    const user = await this.repository.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    return this.generateTokens(user);
  }

  verifyAccessToken(token: string): AuthenticatedUser {
    const payload = this.verifyToken(token, 'access');
    if (!payload.role || !isStaffRole(payload.role)) {
      throw new UnauthorizedError('Invalid token role');
    }

    return {
      id: payload.sub,
      email: (payload.email as string) ?? '',
      role: payload.role
    };
  }

  async seedUser(email: string, password: string, role: StaffRole): Promise<void> {
    const existing = await this.repository.findByEmail(email);
    const passwordHash = await hashPassword(password);
    if (!existing) {
      const shared = await import('@barbershop/shared');
      const client = await shared.getDb().connect();
      try {
        await client.query('BEGIN');
        await this.repository.create(
          {
            id: randomUUID(),
            email,
            passwordHash,
            role
          },
          client
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return;
    }

    // Update password in place for deterministic tests
    const shared = await import('@barbershop/shared');
    await shared.getDb().query('UPDATE users SET password_hash = $1, role = $2 WHERE email = $3', [
      passwordHash,
      role,
      email.toLowerCase()
    ]);
  }

  private generateTokens(user: UserRecord): AuthTokens {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    const accessToken = signJwt(config.JWT_SECRET, {
      expiresInSeconds: config.JWT_ACCESS_TTL_SECONDS,
      subject: user.id,
      type: 'access',
      additionalClaims: {
        email: user.email,
        role: user.role,
        jti: accessJti
      }
    });

    const refreshToken = signJwt(config.JWT_SECRET, {
      expiresInSeconds: config.JWT_REFRESH_TTL_SECONDS,
      subject: user.id,
      type: 'refresh',
      additionalClaims: {
        email: user.email,
        role: user.role,
        jti: refreshJti
      }
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    };
  }

  private verifyToken(token: string, expectedType: 'access' | 'refresh'): JwtPayload {
    try {
      const payload = verifyJwt(token, config.JWT_SECRET);
      if (payload.type !== expectedType) {
        throw new UnauthorizedError('Invalid token type');
      }
      return payload;
    } catch (error) {
      throw new UnauthorizedError('Invalid token');
    }
  }
}

export function isStaffRole(role: string): role is StaffRole {
  return role === 'barbeiro' || role === 'admin';
}

export async function createStaffUser(
  repository: UserRepository,
  email: string,
  password: string,
  role: StaffRole
): Promise<AuthenticatedUser> {
  const passwordHash = await hashPassword(password);
  const shared = await import('@barbershop/shared');
  const client = await shared.getDb().connect();

  try {
    await client.query('BEGIN');
    const user = await repository.create(
      {
        id: randomUUID(),
        email,
        passwordHash,
        role
      },
      client
    );
    await client.query('COMMIT');
    return { id: user.id, email: user.email, role: user.role };
  } catch (error) {
    await client.query('ROLLBACK');
    throw new ConflictError('Failed to seed staff user');
  } finally {
    client.release();
  }
}
