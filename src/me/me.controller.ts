import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { JwtGuard } from '../auth/jwt.guard';
import { CurrentAccount, CurrentPrincipal, PrincipalGuard } from '../auth/principal.guard';
import type { Principal } from '../auth/principal';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import type { MailboxResponse } from '../mailboxes/dto';
import { MailboxService } from '../mailboxes/mailbox.service';
import {
  type AvailabilityQuery,
  type AvailabilityResponse,
  type ClaimAddressRequest,
  type MeResponse,
  availabilitySchema,
  claimAddressSchema,
} from './dto';
import { MeService } from './me.service';

@Controller('me')
@UseGuards(JwtGuard, PrincipalGuard)
export class MeController {
  constructor(
    private readonly service: MeService,
    private readonly mailboxes: MailboxService,
  ) {}

  @Get()
  describe(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    return this.service.describe(principal);
  }

  @Get('address/availability')
  async availability(
    @Query(zodQuery(availabilitySchema)) query: AvailabilityQuery,
  ): Promise<AvailabilityResponse> {
    return { available: await this.mailboxes.isAvailable(query.domainId, query.localPart) };
  }

  @Post('address')
  claim(
    @CurrentAccount() accountId: string,
    @Body(zodBody(claimAddressSchema)) body: ClaimAddressRequest,
  ): Promise<MailboxResponse> {
    return this.mailboxes.createOnPlatform(accountId, body.domainId, body.localPart);
  }
}
