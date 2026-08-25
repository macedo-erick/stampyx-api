import { Module } from '@nestjs/common';

import { AccountRepository } from './account.repository';
import { AccountService } from './account.service';
import { KeycloakAdminClient } from './keycloak-admin.client';
import { ProvisioningController } from './provisioning.controller';

@Module({
  controllers: [ProvisioningController],
  providers: [AccountRepository, AccountService, KeycloakAdminClient],
  exports: [AccountRepository, AccountService, KeycloakAdminClient],
})
export class AccountsModule {}
