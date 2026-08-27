import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';

import { AdminGuard } from '../auth/admin.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentAccount, PrincipalGuard } from '../auth/principal.guard';
import { zodBody } from '../common/zod-validation.pipe';
import type { DnsRecordResponse } from '../domains/dto';
import { PlatformDomainService } from '../domains/platform.service';
import { AdminService } from './admin.service';
import {
  type AdminAccountResponse,
  type AdminDomainResponse,
  type AdminMailboxResponse,
  type ResetPasswordRequest,
  type SetStatusRequest,
  resetPasswordSchema,
  setStatusSchema,
} from './dto';

@Controller('admin')
@UseGuards(JwtGuard, PrincipalGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly service: AdminService,
    private readonly platform: PlatformDomainService,
  ) {}

  @Get('accounts')
  listAccounts(): Promise<AdminAccountResponse[]> {
    return this.service.listAccounts();
  }

  @Put('accounts/:id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(setStatusSchema)) body: SetStatusRequest,
  ): Promise<AdminAccountResponse> {
    return this.service.setStatus(id, body.status);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  deleteAccount(
    @CurrentAccount() actorAccountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.deleteAccount(actorAccountId, id);
  }

  @Get('domains')
  listDomains(): Promise<AdminDomainResponse[]> {
    return this.service.listDomains();
  }

  @Get('mailboxes')
  listMailboxes(): Promise<AdminMailboxResponse[]> {
    return this.service.listMailboxes();
  }

  @Put('mailboxes/:id/password')
  @HttpCode(204)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(resetPasswordSchema)) body: ResetPasswordRequest,
  ): Promise<void> {
    return this.service.resetMailboxPassword(id, body.password);
  }

  @Delete('mailboxes/:id')
  @HttpCode(204)
  deleteMailbox(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.service.deleteMailbox(id);
  }

  @Get('platform-domains/:id/dns')
  platformDns(@Param('id', ParseUUIDPipe) id: string): Promise<DnsRecordResponse[]> {
    return this.platform.dnsRecords(id);
  }
}
