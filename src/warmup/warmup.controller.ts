import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentAccount, PrincipalGuard } from '../auth/principal.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { type WarmupStatus, WarmupService } from './warmup.service';

@Controller('warmup')
@UseGuards(JwtGuard, PrincipalGuard)
export class WarmupController {
  constructor(private readonly service: WarmupService) {}

  @Get()
  status(@CurrentAccount() accountId: string): Promise<WarmupStatus> {
    return this.service.status(accountId);
  }
}
