import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';

import { CONFIG, type Config } from '../config';
import type { Domain } from '../database/schema';
import { generateDkimKeyPair } from './dkim';
import { dnsRecordsFor } from './dns-records';
import { DomainRepository } from './domain.repository';
import type { DnsRecordResponse, PlatformDomainResponse } from './dto';

// Never read: a platform domain is seeded verified, so it has no challenge to publish. The
// column is NOT NULL because every customer domain needs one.
const UNUSED_TOKEN = 'stampyx-platform-domain';

@Injectable()
export class PlatformDomainService implements OnModuleInit {
  private readonly logger = new Logger(PlatformDomainService.name);

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly repository: DomainRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  async seed(): Promise<void> {
    for (const name of this.config.STAMPYX_PLATFORM_DOMAINS) {
      const existing = await this.repository.findByName(name);

      if (existing !== null) {
        // Converting it would hand us a domain a customer already proved they control, and
        // silently move every mailbox on it onto the platform's DNS.
        if (existing.kind !== 'platform') {
          throw new Error(
            `${name} is listed in STAMPYX_PLATFORM_DOMAINS but is already registered as a customer domain. Remove it from the list or delete the customer domain first.`,
          );
        }

        continue;
      }

      const keys = generateDkimKeyPair();

      await this.repository.insert({
        id: randomUUID(),
        accountId: null,
        kind: 'platform',
        name,
        dkimSelector: 'stampyx',
        dkimPrivateKey: keys.privateKeyPem,
        verificationToken: UNUSED_TOKEN,
        verifiedAt: new Date(),
      });

      this.logger.log({ event: 'platform_domain.seeded', name });
    }
  }

  async listActive(): Promise<PlatformDomainResponse[]> {
    const rows = await this.repository.listPlatform();

    return rows
      .filter((row) => row.active)
      .map((row) => ({ id: row.id, name: row.name, active: row.active }));
  }

  async require(id: string): Promise<Domain> {
    const row = await this.repository.findPlatform(id);

    if (row === null) {
      throw new NotFoundException('No such platform domain');
    }

    return row;
  }

  // The DKIM value only exists once the seed has generated the key pair, so this is where
  // the records to publish come from after the first deploy.
  async dnsRecords(id: string): Promise<DnsRecordResponse[]> {
    return dnsRecordsFor(await this.require(id), this.config);
  }
}
