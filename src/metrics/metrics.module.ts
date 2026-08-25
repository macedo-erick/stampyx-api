import { Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

export const MESSAGES_SENT = 'stampyx_messages_sent_total';
export const MESSAGES_RECEIVED = 'stampyx_messages_received_total';
export const SEND_CAP_REJECTIONS = 'stampyx_send_cap_rejections_total';
export const HTTP_REQUEST_DURATION = 'http_request_duration_seconds';

const metrics = [
  makeHistogramProvider({
    name: HTTP_REQUEST_DURATION,
    help: 'HTTP request latency, by route template and response status.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  }),
  makeCounterProvider({
    name: MESSAGES_SENT,
    help: 'Messages accepted for delivery, by whether they carried attachments.',
    labelNames: ['attachments'],
  }),
  makeCounterProvider({
    name: MESSAGES_RECEIVED,
    help: 'Messages delivered to a mailbox, by the folder Sieve filed them into.',
    labelNames: ['folder'],
  }),
  makeCounterProvider({
    name: SEND_CAP_REJECTIONS,
    help: 'Sends rejected with 429 because the account was over its daily warmup cap.',
  }),
];

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultLabels: { app: 'stampyx-api' },
    }),
  ],
  providers: metrics,
  exports: [PrometheusModule, ...metrics],
})
export class MetricsModule {}
