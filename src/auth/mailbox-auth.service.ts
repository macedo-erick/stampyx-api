import { randomUUID } from 'node:crypto';

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

import { CONFIG, type Config } from '../config';
import type { MailboxStanding } from '../mailboxes/mailbox.repository';
import { MailboxRepository } from '../mailboxes/mailbox.repository';
import { hashMailboxPassword, verifyMailboxPassword } from '../mailboxes/password';
import type { ChangePasswordRequest, MailboxLoginRequest, MailboxSessionResponse } from './dto';
import { MailboxSessionRepository } from './mailbox-session.repository';
import { MailboxTokenService, hashRefreshToken } from './mailbox-token.service';

const MAX_ATTEMPTS = 10;
const LOCK_MS = 15 * 60 * 1000;

@Injectable()
export class MailboxAuthService {
  private readonly logger = new Logger(MailboxAuthService.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly mailboxes: MailboxRepository,
    private readonly sessions: MailboxSessionRepository,
    private readonly tokens: MailboxTokenService,
  ) {}

  async login(input: MailboxLoginRequest): Promise<MailboxSessionResponse> {
    const at = input.email.lastIndexOf('@');

    if (at <= 0) {
      throw new UnauthorizedException('Invalid address or password');
    }

    const found = await this.mailboxes.findByAddress(
      input.email.slice(0, at),
      input.email.slice(at + 1),
    );

    if (found === null) {
      throw new UnauthorizedException('Invalid address or password');
    }

    if (found.lockedUntil !== null && found.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Too many failed attempts. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.requireUsable(found);

    if (!(await verifyMailboxPassword(found.passwordHash, input.password))) {
      await this.mailboxes.registerFailedLogin(found.id, MAX_ATTEMPTS, LOCK_MS);
      this.logger.warn({ event: 'mailbox.login_failed', mailboxId: found.id });

      throw new UnauthorizedException('Invalid address or password');
    }

    await this.mailboxes.clearFailedLogins(found.id);

    return this.issue(found);
  }

  async refresh(refreshToken: string): Promise<MailboxSessionResponse> {
    const hash = hashRefreshToken(refreshToken);
    const session = await this.sessions.findByHash(hash);

    if (session === null || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('This session has expired');
    }

    const found = await this.mailboxes.findStanding(session.mailboxId);

    if (found === null) {
      throw new UnauthorizedException('This session is no longer valid');
    }

    this.requireUsable(found);

    await this.sessions.deleteByHash(hash);

    return this.issue(found);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.sessions.deleteByHash(hashRefreshToken(refreshToken));
  }

  async changePassword(mailboxId: string, input: ChangePasswordRequest): Promise<void> {
    const found = await this.mailboxes.findStanding(mailboxId);

    if (found === null) {
      throw new UnauthorizedException('This session is no longer valid');
    }

    if (!(await verifyMailboxPassword(found.passwordHash, input.currentPassword))) {
      throw new ForbiddenException('The current password is not correct');
    }

    await this.mailboxes.setPasswordHash(found.id, await hashMailboxPassword(input.newPassword));
    await this.sessions.deleteForMailbox(found.id);

    this.logger.log({ event: 'mailbox.password_changed', mailboxId: found.id });
  }

  private requireUsable(found: MailboxStanding): void {
    if (!found.active) {
      throw new ForbiddenException('This mailbox is disabled');
    }

    if (!found.domainActive || found.domainVerifiedAt === null) {
      throw new ForbiddenException('This mailbox is on a domain that is not active');
    }

    if (found.accountStatus !== 'active') {
      throw new ForbiddenException('The account this mailbox belongs to is not active');
    }
  }

  private async issue(found: MailboxStanding): Promise<MailboxSessionResponse> {
    const { accessToken, expiresIn } = await this.tokens.sign(found.id, found.accountId);
    const refresh = this.tokens.newRefreshToken();

    await this.sessions.insert({
      id: randomUUID(),
      mailboxId: found.id,
      refreshTokenHash: refresh.hash,
      expiresAt: new Date(Date.now() + this.config.STAMPYX_MAILBOX_REFRESH_TTL * 1000),
    });

    this.logger.log({ event: 'mailbox.session_opened', mailboxId: found.id });

    return {
      accessToken,
      expiresIn,
      refreshToken: refresh.token,
      address: `${found.localPart}@${found.domainName}`,
    };
  }
}
