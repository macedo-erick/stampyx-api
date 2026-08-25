import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { DnsResolver } from './dns.resolver';
import { DomainController } from './domain.controller';
import { DomainRepository } from './domain.repository';
import { DomainService } from './domain.service';
import { PlatformDomainController } from './platform.controller';
import { PlatformDomainService } from './platform.service';

@Module({
  imports: [AccountsModule],
  controllers: [DomainController, PlatformDomainController],
  providers: [DomainRepository, DomainService, DnsResolver, PlatformDomainService],
  exports: [DomainRepository, DnsResolver, PlatformDomainService],
})
export class DomainsModule {}
