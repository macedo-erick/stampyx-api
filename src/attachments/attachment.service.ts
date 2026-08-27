import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { CONFIG, type Config } from '../config';
import type { Attachment } from '../database/schema';
import { MailboxRepository } from '../mailboxes/mailbox.repository';
import { AttachmentRepository } from './attachment.repository';
import type { AttachmentResponse, UploadedFile } from './dto';

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly repository: AttachmentRepository,
    private readonly mailboxes: MailboxRepository,
  ) {}

  async upload(
    accountId: string,
    mailboxId: string,
    file: UploadedFile | undefined,
  ): Promise<AttachmentResponse> {
    await this.requireMailbox(accountId, mailboxId);

    if (file === undefined) {
      throw new BadRequestException('Expected a file');
    }

    const already = await this.draftBytes(mailboxId);

    if (already + file.size > this.config.MAIL_MAX_ATTACHMENT_BYTES) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          error: 'Payload Too Large',
          message: `Attachments may total ${String(this.config.MAIL_MAX_ATTACHMENT_BYTES)} bytes`,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const id = randomUUID();
    // The id is the filename on disk: the name the sender typed never touches a path.
    const directory = path.join(this.config.MAIL_ATTACHMENTS_DIR, mailboxId);
    const storagePath = path.join(directory, id);

    await mkdir(directory, { recursive: true });
    await writeFile(storagePath, file.buffer);

    const created = await this.repository.insert({
      id,
      mailboxId,
      fileName: safeName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath,
    });

    this.logger.log({ event: 'attachment.uploaded', mailboxId, attachmentId: created.id });

    return toResponse(created);
  }

  async listDraft(accountId: string, mailboxId: string): Promise<AttachmentResponse[]> {
    await this.requireMailbox(accountId, mailboxId);

    return (await this.repository.listDrafts(mailboxId)).map(toResponse);
  }

  async remove(accountId: string, mailboxId: string, id: string): Promise<void> {
    await this.requireMailbox(accountId, mailboxId);

    const found = await this.repository.findDraft(mailboxId, id);

    if (found === null) {
      throw new NotFoundException('No such attachment');
    }

    await this.repository.delete(found.id);
    await discard(found.storagePath);

    this.logger.log({ event: 'attachment.deleted', mailboxId, attachmentId: id });
  }

  // The send path: refuses anything not this mailbox's, or already on a sent message.
  async claim(mailboxId: string, ids: readonly string[]): Promise<Attachment[]> {
    const rows = await this.repository.findDrafts(mailboxId, ids);

    if (rows.length !== ids.length) {
      throw new BadRequestException('One or more attachments are unknown');
    }

    const total = rows.reduce((sum, row) => sum + row.sizeBytes, 0);

    if (total > this.config.MAIL_MAX_ATTACHMENT_BYTES) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          error: 'Payload Too Large',
          message: `Attachments may total ${String(this.config.MAIL_MAX_ATTACHMENT_BYTES)} bytes`,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    return rows;
  }

  async attachTo(ids: readonly string[], messageId: string): Promise<void> {
    await this.repository.attachTo(ids, messageId);
  }

  private async draftBytes(mailboxId: string): Promise<number> {
    const rows = await this.repository.listDrafts(mailboxId);

    return rows.reduce((sum, row) => sum + row.sizeBytes, 0);
  }

  private async requireMailbox(accountId: string, mailboxId: string): Promise<void> {
    if ((await this.mailboxes.findOwned(accountId, mailboxId)) === null) {
      throw new NotFoundException('No such mailbox');
    }
  }
}

function toResponse(row: Attachment): AttachmentResponse {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
  };
}

// Display only, but it still ends up in a MIME header, so newlines and separators go.
function safeName(name: string): string {
  return (
    path
      .basename(name)
      .replace(/[\r\n"]/g, '')
      .slice(0, 255) || 'attachment'
  );
}

async function discard(storagePath: string): Promise<void> {
  await unlink(storagePath).catch(() => undefined);
}
