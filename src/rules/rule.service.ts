import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { FolderRule } from '../database/schema';
import type { OwnedMailbox } from '../mailboxes/mailbox.repository';
import { MailboxRepository } from '../mailboxes/mailbox.repository';
import type { RulePreviewRequest, RulePreviewResponse, RuleRequest, RuleResponse } from './dto';
import { RuleRepository } from './rule.repository';
import { SieveWriter } from './sieve.writer';

@Injectable()
export class RuleService {
  private readonly logger = new Logger(RuleService.name);

  constructor(
    private readonly repository: RuleRepository,
    private readonly mailboxes: MailboxRepository,
    private readonly sieve: SieveWriter,
  ) {}

  async list(accountId: string, mailboxId: string): Promise<RuleResponse[]> {
    await this.requireMailbox(accountId, mailboxId);

    return (await this.repository.listFor(mailboxId)).map(toResponse);
  }

  async create(accountId: string, mailboxId: string, input: RuleRequest): Promise<RuleResponse> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);

    const created = await this.repository.insert({
      id: randomUUID(),
      mailboxId,
      position: await this.repository.nextPosition(mailboxId),
      ...input,
    });

    await this.regenerate(mailbox);
    this.logger.log({ event: 'rule.created', ruleId: created.id, accountId });

    return toResponse(created);
  }

  async update(
    accountId: string,
    mailboxId: string,
    id: string,
    input: RuleRequest,
  ): Promise<RuleResponse> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);
    const updated = await this.repository.update(mailboxId, id, input);

    if (updated === null) {
      throw new NotFoundException('No such rule');
    }

    await this.regenerate(mailbox);
    this.logger.log({ event: 'rule.updated', ruleId: id, accountId });

    return toResponse(updated);
  }

  async reorder(
    accountId: string,
    mailboxId: string,
    ruleIds: readonly string[],
  ): Promise<RuleResponse[]> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);
    const existing = await this.repository.listFor(mailboxId);

    // A partial list leaves the omitted rules at position 0, reordering what nobody asked to reorder.
    if (
      ruleIds.length !== existing.length ||
      new Set(ruleIds).size !== ruleIds.length ||
      !existing.every((rule) => ruleIds.includes(rule.id))
    ) {
      throw new BadRequestException('ruleIds must list every rule on this mailbox exactly once');
    }

    const reordered = await this.repository.reorder(mailboxId, ruleIds);

    await this.regenerate(mailbox);
    this.logger.log({ event: 'rule.reordered', mailboxId, accountId });

    return reordered.map(toResponse);
  }

  async delete(accountId: string, mailboxId: string, id: string): Promise<void> {
    const mailbox = await this.requireMailbox(accountId, mailboxId);

    if (!(await this.repository.delete(mailboxId, id))) {
      throw new NotFoundException('No such rule');
    }

    await this.regenerate(mailbox);
    this.logger.log({ event: 'rule.deleted', ruleId: id, accountId });
  }

  // Counted against what actually arrived, so a rule can be seen to catch something before saving.
  async preview(
    accountId: string,
    mailboxId: string,
    input: RulePreviewRequest,
  ): Promise<RulePreviewResponse> {
    await this.requireMailbox(accountId, mailboxId);

    if (input.conditionField === 'recipient') {
      return { supported: false, total: 0, sample: [] };
    }

    const pattern = patternFor(input.conditionOperator, input.conditionValue);
    const column = input.conditionField;

    const [total, sample] = await Promise.all([
      this.repository.previewCount(mailboxId, column, pattern),
      this.repository.previewSample(mailboxId, column, pattern),
    ]);

    return {
      supported: true,
      total,
      sample: sample.map((row) => ({
        id: row.id,
        sender: row.sender,
        subject: row.subject,
        receivedAt: row.receivedAt.toISOString(),
      })),
    };
  }

  private async regenerate(mailbox: OwnedMailbox): Promise<void> {
    const rules = await this.repository.listFor(mailbox.id);

    await this.sieve.write({ domainName: mailbox.domainName, localPart: mailbox.localPart }, rules);

    this.logger.log({ event: 'sieve.regenerated', mailboxId: mailbox.id });
  }

  private async requireMailbox(accountId: string, mailboxId: string): Promise<OwnedMailbox> {
    const mailbox = await this.mailboxes.findOwned(accountId, mailboxId);

    if (mailbox === null) {
      throw new NotFoundException('No such mailbox');
    }

    return mailbox;
  }
}

function toResponse(row: FolderRule): RuleResponse {
  return {
    id: row.id,
    mailboxId: row.mailboxId,
    position: row.position,
    active: row.active,
    conditionField: row.conditionField,
    conditionOperator: row.conditionOperator,
    conditionValue: row.conditionValue,
    action: row.action,
    targetFolder: row.targetFolder,
  };
}

// The value is user text, so its own % and _ must not act as wildcards.
function patternFor(operator: string, value: string): string {
  const literal = value.replace(/([%_\\])/g, '\\$1');

  if (operator === 'equals') {
    return literal;
  }

  if (operator === 'starts_with') {
    return `${literal}%`;
  }

  if (operator === 'ends_with') {
    return `%${literal}`;
  }

  return `%${literal}%`;
}
