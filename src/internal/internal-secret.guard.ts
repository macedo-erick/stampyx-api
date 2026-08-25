import { timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { CONFIG, type Config } from '../config';

export const INTERNAL_SECRET_HEADER = 'x-stampyx-internal';

@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.headers[INTERNAL_SECRET_HEADER];

    if (typeof presented !== 'string' || !matches(presented, this.config.MAIL_INTERNAL_SECRET)) {
      throw new UnauthorizedException('Invalid internal credential');
    }

    return true;
  }
}

function matches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}
