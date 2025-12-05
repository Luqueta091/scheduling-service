import { createHmac } from 'node:crypto';

interface SignOptions {
  expiresInSeconds: number;
  subject: string;
  type: 'access' | 'refresh';
  additionalClaims?: Record<string, unknown>;
}

export interface JwtPayload {
  sub: string;
  role?: string;
  email?: string;
  type: 'access' | 'refresh';
  exp: number;
  iat: number;
  [key: string]: unknown;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlEncodeObject(value: Record<string, unknown>): string {
  return base64UrlEncode(JSON.stringify(value));
}

export function signJwt(secret: string, options: SignOptions): string {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  } as const;

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: options.subject,
    type: options.type,
    iat: issuedAt,
    exp: issuedAt + options.expiresInSeconds,
    ...(options.additionalClaims ?? {})
  };

  const headerBase64 = base64UrlEncodeObject(header);
  const payloadBase64 = base64UrlEncodeObject(payload);
  const signingInput = `${headerBase64}.${payloadBase64}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${signingInput}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const [header, payload, signature] = token.split('.');

  if (!header || !payload || !signature) {
    throw new Error('Invalid token format');
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (expectedSignature !== signature) {
    throw new Error('Invalid token signature');
  }

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as JwtPayload;

  if (decoded.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return decoded;
}
