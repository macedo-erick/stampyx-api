import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

import { CONFIG, type Config } from '../config';
import type { MailboxIdentity } from './principal';

// Ours, not Keycloak's: JwtGuard routes on it, so it must never collide with KEYCLOAK_ISSUER_URI.
export const MAILBOX_ISSUER = 'stampyx';
const AUDIENCE = 'stampyx-panel';

export interface IssuedToken {
  readonly accessToken: string;
  readonly expiresIn: number;
}

@Injectable()
export class MailboxTokenService {
  private readonly secret: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.secret = new TextEncoder().encode(config.STAMPYX_JWT_SECRET);
  }

  async sign(mailboxId: string, accountId: string): Promise<IssuedToken> {
    const expiresIn = this.config.STAMPYX_MAILBOX_TOKEN_TTL;

    const accessToken = await new SignJWT({ aid: accountId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(mailboxId)
      .setIssuer(MAILBOX_ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${String(expiresIn)}s`)
      .sign(this.secret);

    return { accessToken, expiresIn };
  }

  async verify(token: string): Promise<MailboxIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: MAILBOX_ISSUER,
        audience: AUDIENCE,
      });

      const accountId = payload['aid'];

      if (typeof payload.sub !== 'string' || typeof accountId !== 'string') {
        throw new UnauthorizedException('Malformed mailbox token');
      }

      return { kind: 'mailbox', mailboxId: payload.sub, accountId };
    } catch {
      throw new UnauthorizedException('Invalid mailbox token');
    }
  }

  // High-entropy random, so SHA-256 is enough; Argon2 would only slow every refresh.
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');

    return { token, hash: hashRefreshToken(token) };
  }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
