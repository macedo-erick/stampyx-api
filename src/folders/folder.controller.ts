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

import { JwtGuard } from '../auth/jwt.guard';
import { MailboxScopeGuard } from '../auth/mailbox-scope.guard';
import { CurrentAccount, PrincipalGuard } from '../auth/principal.guard';
import { zodBody } from '../common/zod-validation.pipe';
import {
  type CreateFolderRequest,
  type DeleteFolderBody,
  type FolderResponse,
  type RenameFolderBody,
  createFolderSchema,
  deleteFolderSchema,
  renameFolderBodySchema,
} from './dto';
import { FolderService } from './folder.service';

@Controller('mailboxes/:mailboxId/folders')
@UseGuards(JwtGuard, PrincipalGuard, MailboxScopeGuard)
export class FolderController {
  constructor(private readonly service: FolderService) {}

  @Get()
  list(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
  ): Promise<FolderResponse[]> {
    return this.service.list(accountId, mailboxId);
  }

  @Post()
  create(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body(zodBody(createFolderSchema)) body: CreateFolderRequest,
  ): Promise<FolderResponse> {
    return this.service.create(accountId, mailboxId, body);
  }

  @Put('rename')
  rename(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body(zodBody(renameFolderBodySchema)) body: RenameFolderBody,
  ): Promise<FolderResponse> {
    return this.service.rename(accountId, mailboxId, body.path, body.name);
  }

  @Delete()
  @HttpCode(204)
  remove(
    @CurrentAccount() accountId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body(zodBody(deleteFolderSchema)) body: DeleteFolderBody,
  ): Promise<void> {
    return this.service.delete(accountId, mailboxId, body.path);
  }
}
