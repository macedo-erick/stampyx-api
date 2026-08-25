import { randomUUID } from 'node:crypto';

import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Counter } from 'prom-client';

import { DATABASE, type Database } from '../database/db';
import { domain, sendCounter } from '../database/schema';
import { SEND_CAP_REJECTIONS } from '../metrics/metrics.module';
import { dailyCapFor, warmupDay } from './curve';

export interface WarmupStatus {
  readonly day: number;
  readonly dailyCap: number | null;
  readonly sentToday: number;
}

@Injectable()
export class WarmupService {
  private readonly logger = new Logger(WarmupService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @InjectMetric(SEND_CAP_REJECTIONS) private readonly rejections: Counter,
  ) {}

  async status(accountId: string): Promise<WarmupStatus> {
    const days = await this.daysSinceFirstVerified(accountId);
    const [row] = await this.db
      .select({ sent: sendCounter.sent })
      .from(sendCounter)
      .where(and(eq(sendCounter.accountId, accountId), eq(sendCounter.day, today())))
      .limit(1);

    return {
      day: warmupDay(days),
      dailyCap: dailyCapFor(days),
      sentToday: row?.sent ?? 0,
    };
  }

  // Increments only if the result would stay within the cap, in one statement. Checking and
  // then incrementing would let concurrent sends both pass the check.
  async consumeAllowance(accountId: string): Promise<number> {
    const cap = dailyCapFor(await this.daysSinceFirstVerified(accountId));

    if (cap === null) {
      const [row] = await this.db.execute<{ sent: number }>(sql`
        INSERT INTO ${sendCounter} (id, account_id, day, sent)
        VALUES (${randomUUID()}, ${accountId}, ${today()}, 1)
        ON CONFLICT (account_id, day) DO UPDATE SET sent = ${sendCounter}.sent + 1
        RETURNING sent
      `);

      return row?.sent ?? 1;
    }

    const [row] = await this.db.execute<{ sent: number }>(sql`
      INSERT INTO ${sendCounter} (id, account_id, day, sent)
      VALUES (${randomUUID()}, ${accountId}, ${today()}, 1)
      ON CONFLICT (account_id, day) DO UPDATE SET sent = ${sendCounter}.sent + 1
      WHERE ${sendCounter}.sent < ${cap}
      RETURNING sent
    `);

    if (row === undefined) {
      this.rejections.inc();
      this.logger.warn({ event: 'warmup.cap_exceeded', accountId, cap });

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Daily send limit of ${String(cap)} reached while this account is warming up`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return row.sent;
  }

  private async daysSinceFirstVerified(accountId: string): Promise<number> {
    const [row] = await this.db
      .select({ verifiedAt: domain.verifiedAt })
      .from(domain)
      .where(and(eq(domain.accountId, accountId), isNotNull(domain.verifiedAt)))
      .orderBy(asc(domain.verifiedAt))
      .limit(1);

    if (row?.verifiedAt == null) {
      return 0;
    }

    const elapsed = Date.now() - row.verifiedAt.getTime();

    return Math.floor(elapsed / 86_400_000);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
