import { Injectable, NestMiddleware } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { NextFunction, Request, Response } from 'express';
import type { Histogram } from 'prom-client';

import { HTTP_REQUEST_DURATION } from './metrics.module';

type Labels = 'method' | 'route' | 'status_code';

const UNMEASURED = new Set(['/metrics', '/health']);

// Not an interceptor: guards run first, so an interceptor never sees a 401 to count.
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(@InjectMetric(HTTP_REQUEST_DURATION) private readonly duration: Histogram<Labels>) {}

  use(request: Request, response: Response, next: NextFunction): void {
    // `originalUrl`, not `path`: mounted middleware makes `path` relative and it never matches.
    if (UNMEASURED.has(request.originalUrl.split('?')[0] ?? '')) {
      next();

      return;
    }

    const started = process.hrtime.bigint();

    response.once('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;

      this.duration
        .labels(request.method, routeOf(request), String(response.statusCode))
        .observe(seconds);
    });

    next();
  }
}

// The route template, never the concrete path, or the metric is unbounded within a week.
function routeOf(request: Request): string {
  const route = (request as { route?: { path?: string } }).route?.path;

  return route === undefined ? 'unmatched' : `${request.baseUrl}${route}`;
}
