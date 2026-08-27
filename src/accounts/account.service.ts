import { randomUUID } from 'node:crypto';

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

import type { KeycloakIdentity } from '../auth/principal';
import { CONFIG, type Config } from '../config';
import type { Account } from '../database/schema';
import { AccountRepository } from './account.repository';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly repository: AccountRepository,
  ) {}

  async requireActive(user: KeycloakIdentity): Promise<Account> {
    const found = (await this.repository.findBySub(user.sub)) ?? (await this.selfProvision(user));

    if (found.status === 'pending') {
      throw new ForbiddenException('This account is awaiting approval');
    }

    if (found.status === 'suspended') {
      throw new ForbiddenException('This account is suspended');
    }

    return found;
  }

  private async selfProvision(user: KeycloakIdentity): Promise<Account> {
    if (user.email === null) {
      throw new UnauthorizedException('No account is provisioned for this identity');
    }

    await this.repository.provision({
      id: randomUUID(),
      keycloakSub: user.sub,
      email: user.email,
      name: user.name,
      status: this.config.STAMPYX_ACCOUNT_AUTO_APPROVE ? 'active' : 'pending',
    });

    const account = await this.repository.findBySub(user.sub);

    if (account === null) {
      throw new UnauthorizedException('No account is provisioned for this identity');
    }

    this.logger.log({ event: 'account.provisioned', keycloakSub: user.sub, source: 'token' });

    return account;
  }
}
