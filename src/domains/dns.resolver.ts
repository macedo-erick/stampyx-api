import { Resolver } from 'node:dns/promises';

import { Injectable } from '@nestjs/common';

export interface DnsLookups {
  txt(name: string): Promise<string[]>;
  mx(name: string): Promise<{ exchange: string; priority: number }[]>;
  reverse(ip: string): Promise<string[]>;
}

@Injectable()
export class DnsResolver implements DnsLookups {
  private readonly resolver = new Resolver({ timeout: 5_000, tries: 2 });

  async txt(name: string): Promise<string[]> {
    try {
      const records = await this.resolver.resolveTxt(name);

      return records.map((chunks) => chunks.join(''));
    } catch {
      return [];
    }
  }

  async mx(name: string): Promise<{ exchange: string; priority: number }[]> {
    try {
      return await this.resolver.resolveMx(name);
    } catch {
      return [];
    }
  }

  async reverse(ip: string): Promise<string[]> {
    try {
      return await this.resolver.reverse(ip);
    } catch {
      return [];
    }
  }
}
