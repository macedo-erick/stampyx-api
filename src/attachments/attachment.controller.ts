import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile as UploadedFileParam,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtGuard } from '../auth/jwt.guard';
import { MailboxScopeGuard } from '../auth/mailbox-scope.guard';
import { CurrentAccount, PrincipalGuard } from '../auth/principal.guard';
import { AttachmentService } from './attachment.service';
import type { AttachmentResponse, UploadedFile } from './dto';

// A draft on the mailbox until the send binds it to a Message-ID.
@Controller('mailboxes/:mailboxId/attachments')
@UseGuards(JwtGuard, PrincipalGuard, MailboxScopeGuard)
export class AttachmentController {
  constructor(private readonly service: AttachmentService) {}

  @Get()
  list(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
  ): Promise<AttachmentResponse[]> {
    return this.service.listDraft(accountId, mailboxId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @UploadedFileParam() file: UploadedFile | undefined,
  ): Promise<AttachmentResponse> {
    return this.service.upload(accountId, mailboxId, file);
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
