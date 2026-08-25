import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { domain, sendCounter } from '../database/schema';
import { DnsResolver } from '../domains/dns.resolver';
import type { DomainResponse } from '../domains/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import { dailyCapFor } from './curve';
import { WarmupService } from './warmup.service';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();

  const resolver = harness.app.get(DnsResolver);
  vi.spyOn(resolver, 'txt').mockResolvedValue([]);
  vi.spyOn(resolver, 'mx').mockResolvedValue([]);
  vi.spyOn(resolver, 'reverse').mockResolvedValue([]);
});

afterAll(async () => {
  await harness.close();
});

async function accountVerifiedDaysAgo(days: number, name: string): Promise<string> {
  const { sub, accountId } = await harness.newAccount();
  const created = await call<DomainResponse>(harness, sub, 'POST', '/api/domains', { name });

  await harness.db
    .update(domain)
    .set({ verifiedAt: new Date(Date.now() - days * 86_400_000) })
    .where(eq(domain.id, created.body.id));

  return accountId;
}

it('follows the documented warmup curve', () => {
  expect(dailyCapFor(0)).toBe(20);
  expect(dailyCapFor(6)).toBe(20);
  expect(dailyCapFor(7)).toBe(50);
  expect(dailyCapFor(14)).toBe(100);
  expect(dailyCapFor(21)).toBe(200);
  expect(dailyCapFor(28)).toBe(400);
  expect(dailyCapFor(35)).toBeNull();
  expect(dailyCapFor(365)).toBeNull();
});

it('reports the current day, cap and usage', async () => {
  const { sub } = await harness.newAccount();
  const created = await call<DomainResponse>(harness, sub, 'POST', '/api/domains', {
    name: 'warmup-status.com',
  });
  await harness.db
    .update(domain)
    .set({ verifiedAt: new Date(Date.now() - 9 * 86_400_000) })
    .where(eq(domain.id, created.body.id));

  const status = await call<{ day: number; dailyCap: number; sentToday: number }>(
    harness,
    sub,
    'GET',
    '/api/warmup',
  );

  expect(status.body.day).toBe(10);
  expect(status.body.dailyCap).toBe(50);
  expect(status.body.sentToday).toBe(0);
});

it('allows sends up to the cap and refuses the one after', async () => {
  const accountId = await accountVerifiedDaysAgo(0, 'warmup-cap.com');
  const warmup = harness.app.get(WarmupService);

  for (let i = 1; i <= 20; i += 1) {
    await expect(warmup.consumeAllowance(accountId)).resolves.toBe(i);
  }

  await expect(warmup.consumeAllowance(accountId)).rejects.toMatchObject({ status: 429 });
});

it('does not inflate the counter with attempts that were refused', async () => {
  const accountId = await accountVerifiedDaysAgo(0, 'warmup-nocount.com');
  const warmup = harness.app.get(WarmupService);

  for (let i = 0; i < 20; i += 1) {
    await warmup.consumeAllowance(accountId);
  }

  for (let i = 0; i < 5; i += 1) {
    await expect(warmup.consumeAllowance(accountId)).rejects.toMatchObject({ status: 429 });
  }

  const [row] = await harness.db
    .select()
    .from(sendCounter)
    .where(eq(sendCounter.accountId, accountId));

  expect(row?.sent).toBe(20);
});

it('holds the cap under concurrent sends', async () => {
  const accountId = await accountVerifiedDaysAgo(0, 'warmup-race.com');
  const warmup = harness.app.get(WarmupService);

  const results = await Promise.allSettled(
    Array.from({ length: 60 }, () => warmup.consumeAllowance(accountId)),
  );

  const allowed = results.filter((result) => result.status === 'fulfilled').length;

  expect(allowed).toBe(20);

  const [row] = await harness.db
    .select()
    .from(sendCounter)
    .where(eq(sendCounter.accountId, accountId));

  expect(row?.sent).toBe(20);
});

it('stops capping once the account is past the curve', async () => {
  const accountId = await accountVerifiedDaysAgo(60, 'warmup-graduated.com');
  const warmup = harness.app.get(WarmupService);

  for (let i = 1; i <= 500; i += 1) {
    await warmup.consumeAllowance(accountId);
  }

  const [row] = await harness.db
    .select()
    .from(sendCounter)
    .where(eq(sendCounter.accountId, accountId));

  expect(row?.sent).toBe(500);
});

it('caps an account with no verified domain at the opening rate', async () => {
  const { accountId } = await harness.newAccount();
  const warmup = harness.app.get(WarmupService);

  for (let i = 0; i < 20; i += 1) {
    await warmup.consumeAllowance(accountId);
  }

  await expect(warmup.consumeAllowance(accountId)).rejects.toMatchObject({ status: 429 });
});
