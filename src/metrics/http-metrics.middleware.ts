import { Injectable, NestMiddleware } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { NextFunction, Request, Response } from 'express';
import type { Histogram } from 'prom-client';

import { HTTP_REQUEST_DURATION } from './metrics.module';

type Labels = 'method' | 'route' | 'status_code';

const UNMEASURED = new Set(['/metrics', '/health']);

// Middleware rather than an interceptor: guards run before interceptors, so an interceptor
// never sees a rejected request and every 401 would go uncounted.
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(@InjectMetric(HTTP_REQUEST_DURATION) private readonly duration: Histogram<Labels>) {}

  use(request: Request, response: Response, next: NextFunction): void {
    // `originalUrl`, not `path`: the middleware is mounted, so `path` is relative to the
    // mount point and never matches these.
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

// The route template, never the concrete path: one series per endpoint rather than one per
// list id, which would make the metric unbounded within a week of real use.
function routeOf(request: Request): string {
  const route = (request as { route?: { path?: string } }).route?.path;

  return route === undefined ? 'unmatched' : `${request.baseUrl}${route}`;
}
