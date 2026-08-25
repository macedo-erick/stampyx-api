import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';

import { JwtGuard } from '../auth/jwt.guard';
import { MailboxScopeGuard } from '../auth/mailbox-scope.guard';
import { CurrentAccount, PrincipalGuard } from '../auth/principal.guard';
import { AliasService } from './alias.service';
import type { AliasResponse } from './dto';

@Controller('mailboxes/:mailboxId/aliases')
@UseGuards(JwtGuard, PrincipalGuard, MailboxScopeGuard)
export class AliasController {
  constructor(private readonly service: AliasService) {}

  @Get()
  list(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
  ): Promise<AliasResponse[]> {
    return this.service.listForMailbox(accountId, mailboxId);
  }
}
