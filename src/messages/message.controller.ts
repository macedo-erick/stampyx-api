import {
  Body,
  Controller,
  ParseIntPipe,
  StreamableFile,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentAccount, PrincipalGuard } from '../auth/principal.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { MailboxScopeGuard } from '../auth/mailbox-scope.guard';
import type { PageResponse } from '../common/page-response';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import {
  type ListMessagesQuery,
  type MessageDetail,
  type MessageSummary,
  type MoveMessageRequest,
  type SendMessageRequest,
  type SetReadRequest,
  listMessagesSchema,
  moveMessageSchema,
  sendMessageSchema,
  setReadSchema,
} from './dto';
import { MessageService } from './message.service';

@Controller('mailboxes/:mailboxId/messages')
@UseGuards(JwtGuard, PrincipalGuard, MailboxScopeGuard)
export class MessageController {
  constructor(private readonly service: MessageService) {}

  @Get()
  list(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Query(zodQuery(listMessagesSchema)) query: ListMessagesQuery,
  ): Promise<PageResponse<MessageSummary>> {
    return this.service.list(accountId, mailboxId, query);
  }

  // Streams the bytes rather than handing back base64: an attachment is a file, and the
  // browser should be able to save it like one.
  @Get(':id/attachments/:index')
  async attachment(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
  ): Promise<StreamableFile> {
    const found = await this.service.readAttachment(accountId, mailboxId, id, index);

    return new StreamableFile(found.content, {
      type: found.contentType,
      disposition: `attachment; filename="${found.fileName.replace(/["\r\n]/g, '')}"`,
    });
  }

  @Get(':id')
  read(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageDetail> {
    return this.service.read(accountId, mailboxId, id);
  }

  // A draft is not sent, so it never reaches the MTA: it is composed and appended straight
  // into the Drafts folder.
  @Post('drafts')
  @HttpCode(204)
  saveDraft(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body(zodBody(sendMessageSchema)) body: SendMessageRequest,
  ): Promise<void> {
    return this.service.saveDraft(accountId, mailboxId, body);
  }

  @Post()
  send(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body(zodBody(sendMessageSchema)) body: SendMessageRequest,
  ): Promise<{ messageId: string }> {
    return this.service.send(accountId, mailboxId, body);
  }

  @Put(':id/read')
  @HttpCode(204)
  markRead(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(setReadSchema)) body: SetReadRequest,
  ): Promise<void> {
    return this.service.markRead(accountId, mailboxId, id, body.read);
  }

  @Put(':id/folder')
  @HttpCode(204)
  move(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(moveMessageSchema)) body: MoveMessageRequest,
  ): Promise<void> {
    return this.service.move(accountId, mailboxId, id, body.folder);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(accountId, mailboxId, id);
  }
}
