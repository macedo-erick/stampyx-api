import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { CONFIG, type Config } from '../config';

export interface KeycloakUser {
  readonly id: string;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

interface CachedToken {
  readonly value: string;
  readonly expiresAt: number;
}

// Valid when we check should still be valid when it arrives.
const EXPIRY_MARGIN_MS = 30_000;

// Plain fetch: keycloak-admin-client is a large tree for two calls and pins its own version.
@Injectable()
export class KeycloakAdminClient {
  private token: CachedToken | null = null;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  async findUser(id: string): Promise<KeycloakUser> {
    const response = await this.authorized(
      `/admin/realms/${this.config.KEYCLOAK_REALM}/users/${encodeURIComponent(id)}`,
    );

    if (response.status === 404) {
      throw new NotFoundException('No such user');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Keycloak answered ${String(response.status)} for a user lookup`,
      );
    }

    const body = (await response.json()) as Record<string, unknown>;

    return {
      id,
      email: typeof body['email'] === 'string' ? body['email'] : null,
      firstName: typeof body['firstName'] === 'string' ? body['firstName'] : null,
      lastName: typeof body['lastName'] === 'string' ? body['lastName'] : null,
    };
  }

  private async authorized(path: string): Promise<Response> {
    const token = await this.accessToken();

    return fetch(`${this.config.KEYCLOAK_SERVER_URL}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();

    if (this.token !== null && this.token.expiresAt > now) {
      return this.token.value;
    }

    const response = await fetch(
      `${this.config.KEYCLOAK_SERVER_URL}/realms/${this.config.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.KEYCLOAK_ADMIN_CLIENT_ID,
          client_secret: this.config.KEYCLOAK_ADMIN_CLIENT_SECRET,
        }),
      },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException('Could not obtain a Keycloak service-account token');
    }

    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };

    if (typeof body.access_token !== 'string') {
      throw new ServiceUnavailableException('Keycloak returned a token response with no token');
    }

    const lifetimeMs = (typeof body.expires_in === 'number' ? body.expires_in : 60) * 1000;

    this.token = {
      value: body.access_token,
      expiresAt: now + Math.max(lifetimeMs - EXPIRY_MARGIN_MS, 0),
    };

    return this.token.value;
  }
}
