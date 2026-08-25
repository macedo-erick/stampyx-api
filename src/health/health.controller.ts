import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([(): Promise<HealthIndicatorResult> => this.database()]);
  }

  private async database(): Promise<HealthIndicatorResult> {
    const check = this.indicator.check('database');

    try {
      await this.db.execute(sql`SELECT 1`);

      return check.up();
    } catch (error) {
      return check.down({ message: error instanceof Error ? error.message : 'unreachable' });
    }
  }
}
