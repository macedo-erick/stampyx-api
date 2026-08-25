import { randomBytes, randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CONFIG, type Config } from '../config';
import type { Domain } from '../database/schema';
import { generateDkimKeyPair } from './dkim';
import { CHALLENGE_PREFIX, type DnsCheckReport, runDnsCheck } from './dns-check';
import { checkInputFor, dnsRecordsFor } from './dns-records';
import { DnsResolver } from './dns.resolver';
import { DomainRepository } from './domain.repository';
import type { DnsRecordResponse, DomainResponse } from './dto';

@Injectable()
export class DomainService {
  private readonly logger = new Logger(DomainService.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly repository: DomainRepository,
    private readonly dns: DnsResolver,
  ) {}

  async list(accountId: string): Promise<DomainResponse[]> {
    const rows = await this.repository.listFor(accountId);

    return rows.map((row) => toResponse(row));
  }

  async get(accountId: string, id: string): Promise<DomainResponse> {
    const row = await this.requireOwned(accountId, id);

    return { ...toResponse(row), dnsRecords: this.recordsFor(row) };
  }

  async create(accountId: string, name: string): Promise<DomainResponse> {
    // 409 leaks only that the domain is taken, which its public DNS already says.
    if ((await this.repository.findByName(name)) !== null) {
      throw new ConflictException('That domain is already registered');
    }

    const keys = generateDkimKeyPair();

    const created = await this.repository.insert({
      id: randomUUID(),
      accountId,
      name,
      dkimSelector: 'stampyx',
      dkimPrivateKey: keys.privateKeyPem,
      verificationToken: `stampyx-verify=${randomBytes(24).toString('base64url')}`,
    });

    this.logger.log({ event: 'domain.created', domainId: created.id, accountId });

    return { ...toResponse(created), dnsRecords: this.recordsFor(created) };
  }

  async check(accountId: string, id: string): Promise<DnsCheckReport> {
    const row = await this.requireOwned(accountId, id);

    return runDnsCheck(this.dns, this.checkInput(row));
  }

  // Separate from dns-check: other records can be fixed later, but until the challenge TXT
  // is present the SQL views keep this domain out of Postfix and Dovecot entirely.
  async verify(accountId: string, id: string): Promise<DomainResponse> {
    const row = await this.requireOwned(accountId, id);

    if (row.verifiedAt !== null) {
      return toResponse(row);
    }

    const published = await this.dns.txt(`${CHALLENGE_PREFIX}.${row.name}`);

    if (!published.includes(row.verificationToken)) {
      throw new ConflictException(
        `No matching ${CHALLENGE_PREFIX}.${row.name} TXT record found. DNS changes can take a while to propagate.`,
      );
    }

    const verified = await this.repository.markVerified(accountId, id);

    if (verified === null) {
      throw new NotFoundException('No such domain');
    }

    this.logger.log({ event: 'domain.verified', domainId: id, accountId });

    return toResponse(verified);
  }

  async delete(accountId: string, id: string): Promise<void> {
    if (!(await this.repository.delete(accountId, id))) {
      throw new NotFoundException('No such domain');
    }

    this.logger.log({ event: 'domain.deleted', domainId: id, accountId });
  }

  private async requireOwned(accountId: string, id: string): Promise<Domain> {
    const row = await this.repository.findOwned(accountId, id);

    if (row === null) {
      throw new NotFoundException('No such domain');
    }

    return row;
  }

  private recordsFor(row: Domain): DnsRecordResponse[] {
    return dnsRecordsFor(row, this.config);
  }

  private checkInput(row: Domain) {
    return checkInputFor(row, this.config);
  }
}

function toResponse(row: Domain): DomainResponse {
  return {
    id: row.id,
    name: row.name,
    dkimSelector: row.dkimSelector,
    verified: row.verifiedAt !== null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}
