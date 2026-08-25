import { Global, Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { AdminGuard } from './admin.guard';
import { JwtGuard } from './jwt.guard';
import { MailboxAuthController } from './mailbox-auth.controller';
import { MailboxAuthService } from './mailbox-auth.service';
import { MailboxSessionRepository } from './mailbox-session.repository';
import { MailboxScopeGuard } from './mailbox-scope.guard';
import { MailboxTokenService } from './mailbox-token.service';
import { PrincipalGuard } from './principal.guard';
import { PrincipalResolver } from './principal.resolver';

// Global, and it re-exports what the guards inject: an enhancer named in @UseGuards is
// constructed in the host controller's module, so AccountService and MailboxRepository have
// to be resolvable from every one of them. Importing AuthModule in each would close a cycle
// back through MailboxesModule.
@Global()
@Module({
  imports: [AccountsModule, MailboxesModule],
  controllers: [MailboxAuthController],
  providers: [
    JwtGuard,
    PrincipalGuard,
    MailboxScopeGuard,
    AdminGuard,
    MailboxTokenService,
    MailboxAuthService,
    MailboxSessionRepository,
    PrincipalResolver,
  ],
  exports: [
    AccountsModule,
    MailboxesModule,
    JwtGuard,
    PrincipalGuard,
    MailboxScopeGuard,
    AdminGuard,
    MailboxTokenService,
    MailboxSessionRepository,
    PrincipalResolver,
  ],
})
export class AuthModule {}
