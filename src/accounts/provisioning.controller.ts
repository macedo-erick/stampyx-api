import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { CONFIG, type Config } from '../config';
import { AccountRepository } from './account.repository';
import { provisioningEventSchema } from './dto';
import { KeycloakAdminClient } from './keycloak-admin.client';
import {
  PROVISIONING_SIGNATURE_HEADER,
  verifyProvisioningSignature,
} from './provisioning-signature';

const MAX_SKEW_MS = 5 * 60 * 1000;

@Controller('internal/keycloak')
export class ProvisioningController {
  private readonly logger = new Logger(ProvisioningController.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly accounts: AccountRepository,
    private readonly keycloak: KeycloakAdminClient,
  ) {}

  @Post('user-registered')
  @HttpCode(202)
  async userRegistered(@Req() request: RawBodyRequest<Request>): Promise<{ status: string }> {
    const raw = request.rawBody;

    if (raw === undefined) {
      throw new BadRequestException('Expected a raw body');
    }

    const signature = request.headers[PROVISIONING_SIGNATURE_HEADER];

    if (
      typeof signature !== 'string' ||
      !verifyProvisioningSignature(raw, signature, this.config.STAMPYX_PROVISIONING_SECRET)
    ) {
      throw new UnauthorizedException('Invalid provisioning signature');
    }

    const parsed = provisioningEventSchema.safeParse(safeJson(raw));

    if (!parsed.success) {
      throw new BadRequestException('Malformed provisioning event');
    }

    const event = parsed.data;

    if (Math.abs(Date.now() - event.timestamp) > MAX_SKEW_MS) {
      throw new UnauthorizedException('Provisioning event is outside the accepted time window');
    }

    if (event.realm !== this.config.KEYCLOAK_REALM) {
      throw new UnauthorizedException('Provisioning event is for another realm');
    }

    const user = await this.keycloak.findUser(event.userId);

    if (user.email === null) {
      throw new BadRequestException('Registered user has no email address');
    }

    const { created } = await this.accounts.provision({
      id: randomUUID(),
      keycloakSub: event.userId,
      email: user.email,
      name: fullName(user.firstName, user.lastName),
    });

    if (created) {
      this.logger.log({ event: 'account.provisioned', keycloakSub: event.userId });
    }

    return { status: created ? 'created' : 'already-provisioned' };
  }
}

function safeJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
}

function fullName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter((part): part is string => part !== null && part !== '');

  return parts.length === 0 ? null : parts.join(' ');
}
