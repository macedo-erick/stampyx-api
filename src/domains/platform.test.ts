import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { domain } from '../database/schema';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import { DnsResolver } from './dns.resolver';
import type { DomainResponse, PlatformDomainResponse } from './dto';

const PLATFORM = 'platform-seeded.test';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp({ config: { STAMPYX_PLATFORM_DOMAINS: [PLATFORM] } });

  const resolver = harness.app.get(DnsResolver);
  vi.spyOn(resolver, 'txt').mockResolvedValue([]);
  vi.spyOn(resolver, 'mx').mockResolvedValue([]);
  vi.spyOn(resolver, 'reverse').mockResolvedValue([]);
});

afterAll(async () => {
  await harness.close();
});

it('seeds a platform domain that is verified and owned by nobody', async () => {
  const [row] = await harness.db.select().from(domain).where(eq(domain.name, PLATFORM));

  expect(row?.kind).toBe('platform');
  expect(row?.accountId).toBeNull();
  expect(row?.verifiedAt).not.toBeNull();
  expect(row?.dkimPrivateKey.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);
});

it('offers the platform domain to a signed-in account', async () => {
  const { sub } = await harness.newAccount();

  const listed = await call<PlatformDomainResponse[]>(harness, sub, 'GET', '/api/platform-domains');

  expect(listed.status).toBe(200);
  expect(listed.body.map((row) => row.name)).toContain(PLATFORM);
});

it('refuses to let a tenant register a domain the platform owns', async () => {
  const { sub } = await harness.newAccount();

  const created = await call<DomainResponse>(harness, sub, 'POST', '/api/domains', {
    name: PLATFORM,
  });

  expect(created.status).toBe(409);
});

it('keeps the platform domain out of the domain list an account sees', async () => {
  const { sub } = await harness.newAccount();

  const listed = await call<DomainResponse[]>(harness, sub, 'GET', '/api/domains');

  expect(listed.body).toHaveLength(0);
});
