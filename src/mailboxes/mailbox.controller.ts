import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentAccount, PrincipalGuard } from '../auth/principal.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { MailboxScopeGuard } from '../auth/mailbox-scope.guard';
import { zodBody } from '../common/zod-validation.pipe';
import {
  type CreateMailboxRequest,
  type MailboxResponse,
  type SetPasswordRequest,
  createMailboxSchema,
  setPasswordSchema,
} from './dto';
import { MailboxService } from './mailbox.service';

@Controller('domains/:domainId/mailboxes')
@UseGuards(JwtGuard, PrincipalGuard)
export class DomainMailboxController {
  constructor(private readonly service: MailboxService) {}

  @Get()
  list(
    @CurrentAccount() accountId: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ): Promise<MailboxResponse[]> {
    return this.service.listForDomain(accountId, domainId);
  }

  @Post()
  create(
    @CurrentAccount() accountId: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Body(zodBody(createMailboxSchema)) body: CreateMailboxRequest,
  ): Promise<MailboxResponse> {
    return this.service.create(accountId, domainId, body);
  }
}

@Controller('mailboxes')
@UseGuards(JwtGuard, PrincipalGuard, MailboxScopeGuard)
export class MailboxController {
  constructor(private readonly service: MailboxService) {}

  @Get(':mailboxId')
  get(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) id: string,
  ): Promise<MailboxResponse> {
    return this.service.get(accountId, id);
  }

  @Put(':mailboxId/password')
  @HttpCode(204)
  setPassword(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) id: string,
    @Body(zodBody(setPasswordSchema)) body: SetPasswordRequest,
  ): Promise<void> {
    return this.service.setPassword(accountId, id, body.password);
  }

  @Delete(':mailboxId')
  @HttpCode(204)
  delete(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(accountId, id);
  }
}
