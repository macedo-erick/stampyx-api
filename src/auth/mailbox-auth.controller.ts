import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { zodBody } from '../common/zod-validation.pipe';
import {
  type ChangePasswordRequest,
  type MailboxLoginRequest,
  type MailboxSessionResponse,
  type RefreshRequest,
  changePasswordSchema,
  mailboxLoginSchema,
  refreshSchema,
} from './dto';
import { JwtGuard } from './jwt.guard';
import { MailboxAuthService } from './mailbox-auth.service';
import type { Principal } from './principal';
import { CurrentPrincipal, PrincipalGuard } from './principal.guard';

// Mailbox users are provisioned by an administrator, never self-registered, so they have no
// Keycloak identity to log in with. Their password is the one Dovecot checks, which is what
// makes a change here take effect on IMAP and SMTP in the same write.
@Controller('auth/mailbox')
export class MailboxAuthController {
  constructor(private readonly service: MailboxAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(
    @Body(zodBody(mailboxLoginSchema)) body: MailboxLoginRequest,
  ): Promise<MailboxSessionResponse> {
    return this.service.login(body);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(zodBody(refreshSchema)) body: RefreshRequest): Promise<MailboxSessionResponse> {
    return this.service.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Body(zodBody(refreshSchema)) body: RefreshRequest): Promise<void> {
    return this.service.logout(body.refreshToken);
  }

  @Put('password')
  @HttpCode(204)
  @UseGuards(JwtGuard, PrincipalGuard)
  changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(changePasswordSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    // An account owner resets a mailbox they own through PUT /mailboxes/:id/password, which
    // needs no current password because they administer it.
    if (principal.kind !== 'mailbox') {
      throw new ForbiddenException('This endpoint is for mailbox sessions');
    }

    return this.service.changePassword(principal.mailboxId, body);
  }
}
