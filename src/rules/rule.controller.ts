import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { CurrentAccount, PrincipalGuard } from '../auth/principal.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { MailboxScopeGuard } from '../auth/mailbox-scope.guard';
import { zodBody } from '../common/zod-validation.pipe';
import {
  type ReorderRulesRequest,
  type RulePreviewRequest,
  type RulePreviewResponse,
  type RuleRequest,
  type RuleResponse,
  reorderRulesSchema,
  rulePreviewSchema,
  ruleSchema,
} from './dto';
import { RuleService } from './rule.service';

@Controller('mailboxes/:mailboxId/rules')
@UseGuards(JwtGuard, PrincipalGuard, MailboxScopeGuard)
export class RuleController {
  constructor(private readonly service: RuleService) {}

  @Get()
  list(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
  ): Promise<RuleResponse[]> {
    return this.service.list(accountId, mailboxId);
  }

  @Post()
  create(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body(zodBody(ruleSchema)) body: RuleRequest,
  ): Promise<RuleResponse> {
    return this.service.create(accountId, mailboxId, body);
  }

  // POST because it carries a candidate rule, not because it changes anything.
  @Post('preview')
  @HttpCode(200)
  preview(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body(zodBody(rulePreviewSchema)) body: RulePreviewRequest,
  ): Promise<RulePreviewResponse> {
    return this.service.preview(accountId, mailboxId, body);
  }

  @Put('order')
  @HttpCode(200)
  reorder(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body(zodBody(reorderRulesSchema)) body: ReorderRulesRequest,
  ): Promise<RuleResponse[]> {
    return this.service.reorder(accountId, mailboxId, body.ruleIds);
  }

  @Put(':id')
  update(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(ruleSchema)) body: RuleRequest,
  ): Promise<RuleResponse> {
    return this.service.update(accountId, mailboxId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(accountId, mailboxId, id);
  }
}
