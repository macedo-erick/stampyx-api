import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { MailboxRepository } from '../mailboxes/mailbox.repository';
import { RuleRepository } from './rule.repository';
import { SieveWriter } from './sieve.writer';

// The Sieve script carries the notify pipe, and the pipe is the only thing that records an
// incoming message. Writing it on mailbox creation covers new mailboxes; this covers the
// ones that already existed, and rewrites any script the current generator would produce
// differently - otherwise a fix to the generator never reaches a mailbox that has a file.
@Injectable()
export class SieveReconciler implements OnModuleInit {
  private readonly logger = new Logger(SieveReconciler.name);

  constructor(
    private readonly mailboxes: MailboxRepository,
    private readonly rules: RuleRepository,
    private readonly sieve: SieveWriter,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile();
  }

  async reconcile(): Promise<void> {
    const all = await this.mailboxes.listAllActive();
    let written = 0;

    for (const row of all) {
      const target = { domainName: row.domainName, localPart: row.localPart };

      try {
        const rules = await this.rules.listFor(row.id);

        if (await this.sieve.isCurrent(target, rules)) {
          continue;
        }

        await this.sieve.write(target, rules);
        written += 1;
      } catch (error) {
        // One unwritable mailbox must not stop the rest, nor the boot.
        this.logger.warn({
          event: 'sieve.reconcile_failed',
          mailboxId: row.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (written > 0) {
      this.logger.log({ event: 'sieve.reconciled', written, total: all.length });
    }
  }
}
