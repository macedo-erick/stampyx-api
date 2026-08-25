import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentAccount, PrincipalGuard } from '../auth/principal.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { zodBody } from '../common/zod-validation.pipe';
import type { DnsCheckReport } from './dns-check';
import { DomainService } from './domain.service';
import { type CreateDomainRequest, type DomainResponse, createDomainSchema } from './dto';

@Controller('domains')
@UseGuards(JwtGuard, PrincipalGuard)
export class DomainController {
  constructor(private readonly service: DomainService) {}

  @Get()
  list(@CurrentAccount() accountId: string): Promise<DomainResponse[]> {
    return this.service.list(accountId);
  }

  @Get(':id')
  get(
    @CurrentAccount() accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DomainResponse> {
    return this.service.get(accountId, id);
  }

  @Post()
  create(
    @CurrentAccount() accountId: string,
    @Body(zodBody(createDomainSchema)) body: CreateDomainRequest,
  ): Promise<DomainResponse> {
    return this.service.create(accountId, body.name);
  }

  @Get(':id/dns-check')
  check(
    @CurrentAccount() accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DnsCheckReport> {
    return this.service.check(accountId, id);
  }

  @Post(':id/verify')
  @HttpCode(200)
  verify(
    @CurrentAccount() accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DomainResponse> {
    return this.service.verify(accountId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @CurrentAccount() accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(accountId, id);
  }
}
