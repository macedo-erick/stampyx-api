import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtGuard } from '../auth/jwt.guard';
import { PrincipalGuard } from '../auth/principal.guard';
import type { PlatformDomainResponse } from './dto';
import { PlatformDomainService } from './platform.service';

@Controller('platform-domains')
@UseGuards(JwtGuard, PrincipalGuard)
export class PlatformDomainController {
  constructor(private readonly service: PlatformDomainService) {}

  @Get()
  list(): Promise<PlatformDomainResponse[]> {
    return this.service.listActive();
  }
}
