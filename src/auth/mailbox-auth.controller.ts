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
    if (principal.kind !== 'mailbox') {
      throw new ForbiddenException('This endpoint is for mailbox sessions');
    }

    return this.service.changePassword(principal.mailboxId, body);
  }
}
