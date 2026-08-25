import { Injectable } from '@nestjs/common';

import { MailboxService } from '../mailboxes/mailbox.service';
import { AliasRepository } from './alias.repository';
import type { AliasResponse } from './dto';

@Injectable()
export class AliasService {
  constructor(
    private readonly repository: AliasRepository,
    private readonly mailboxes: MailboxService,
  ) {}

  async listForMailbox(accountId: string, mailboxId: string): Promise<AliasResponse[]> {
    const mailbox = await this.mailboxes.get(accountId, mailboxId);
    const rows = await this.repository.listForDestination(mailbox.address);

    return rows.map((row) => ({ id: row.id, source: row.source, destination: row.destination }));
  }
}
