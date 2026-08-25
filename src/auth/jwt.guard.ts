import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { type JWTVerifyGetKey, createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

import { CONFIG, type Config, jwksUri } from '../config';
import { MAILBOX_ISSUER, MailboxTokenService } from './mailbox-token.service';
import type { Identity, KeycloakIdentity, Principal } from './principal';

declare module 'express' {
  interface Request {
    identity?: Identity;
    principal?: Principal;
  }
}

// Two issuers reach this guard: Keycloak, for people who registered themselves, and stampyx
// itself, for mailbox users an administrator provisioned. The issuer decides which key
// verifies the token; nothing is trusted before that.
@Injectable()
export class JwtGuard implements CanActivate {
  private readonly logger = new Logger(JwtGuard.name);
  private readonly keys: JWTVerifyGetKey;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly mailboxTokens: MailboxTokenService,
  ) {
    this.keys = createRemoteJWKSet(jwksUri(config));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request.headers.authorization);

    if (token === null) {
      throw new UnauthorizedException('Missing bearer token');
    }

    request.identity = await this.identify(token);

    return true;
  }

  async identify(token: string): Promise<Identity> {
    // Read only to route. The claim is unverified here and is thrown away either way.
    if (unverifiedIssuer(token) === MAILBOX_ISSUER) {
      return this.mailboxTokens.verify(token);
    }

    return this.verifyKeycloak(token);
  }

  private async verifyKeycloak(token: string): Promise<KeycloakIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.config.KEYCLOAK_ISSUER_URI,
      });

      if (typeof payload.sub !== 'string' || payload.sub === '') {
        throw new UnauthorizedException('Token carries no subject');
      }

      return {
        kind: 'keycloak',
        sub: payload.sub,
        email: claim(payload['email']),
        name: claim(payload['name']) ?? claim(payload['preferred_username']),
        admin: rolesOf(payload['realm_access']).includes(this.config.STAMPYX_ADMIN_ROLE),
      };
    } catch (error) {
      this.logger.warn(
        `Rejected a bearer token: ${error instanceof Error ? error.message : String(error)}`,
      );

      throw new UnauthorizedException('Invalid bearer token');
    }
  }
}

function unverifiedIssuer(token: string): string | null {
  try {
    return decodeJwt(token).iss ?? null;
  } catch {
    return null;
  }
}

function rolesOf(realmAccess: unknown): string[] {
  if (typeof realmAccess !== 'object' || realmAccess === null) {
    return [];
  }

  const roles = (realmAccess as Record<string, unknown>)['roles'];

  return Array.isArray(roles)
    ? roles.filter((role): role is string => typeof role === 'string')
    : [];
}

function claim(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }

  const [scheme, ...rest] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || rest.length !== 1) {
    return null;
  }

  return rest[0] ?? null;
}
