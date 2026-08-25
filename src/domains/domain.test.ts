import { eq } from 'drizzle-orm';
import { type Mock, afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { domain } from '../database/schema';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import { CHALLENGE_PREFIX } from './dns-check';
import { DnsResolver } from './dns.resolver';
import type { DomainResponse } from './dto';

let harness: TestHarness;
let txt: Mock<(name: string) => Promise<string[]>>;

beforeAll(async () => {
  harness = await startTestApp({
    config: { MAIL_HOSTNAME: 'mail.stampyx.com', MAIL_PUBLIC_IP: '203.0.113.10' },
  });

  const resolver = harness.app.get(DnsResolver);

  txt = vi.fn<(name: string) => Promise<string[]>>().mockResolvedValue([]);
  vi.spyOn(resolver, 'txt').mockImplementation(txt);
  vi.spyOn(resolver, 'mx').mockResolvedValue([]);
  vi.spyOn(resolver, 'reverse').mockResolvedValue([]);
});

beforeEach(() => {
  txt.mockReset();
  txt.mockResolvedValue([]);
});

afterAll(async () => {
  await harness.close();
});

async function createDomain(sub: string, name: string): Promise<DomainResponse> {
  const created = await call<DomainResponse>(harness, sub, 'POST', '/api/domains', { name });

  expect(created.status).toBe(201);

  return created.body;
}

it('creates a domain with a generated DKIM key and the records to publish', async () => {
  const { sub } = await harness.newAccount();

  const created = await createDomain(sub, 'example-one.com');

  expect(created.verified).toBe(false);
  expect(created.dnsRecords?.map((record) => record.type)).toEqual([
    'TXT',
    'MX',
    'TXT',
    'TXT',
    'TXT',
  ]);

  const dkim = created.dnsRecords?.find((record) => record.host.includes('_domainkey'));
  expect(dkim?.value).toMatch(/^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]+$/);

  const spf = created.dnsRecords?.find((record) => record.value.startsWith('v=spf1'));
  expect(spf?.value).toBe('v=spf1 ip4:203.0.113.10 -all');
});

it('never stores the DKIM private key where a response could carry it', async () => {
  const { sub } = await harness.newAccount();

  const created = await createDomain(sub, 'example-two.com');

  expect(JSON.stringify(created)).not.toContain('PRIVATE KEY');

  const [row] = await harness.db.select().from(domain).where(eq(domain.id, created.id));
  expect(row?.dkimPrivateKey).toContain('BEGIN PRIVATE KEY');
});

it('refuses a domain another account already registered', async () => {
  const first = await harness.newAccount();
  const second = await harness.newAccount();

  await createDomain(first.sub, 'contested.com');

  const result = await call(harness, second.sub, 'POST', '/api/domains', { name: 'contested.com' });

  expect(result.status).toBe(409);
});

it("answers 404, not 403, for another account's domain", async () => {
  const owner = await harness.newAccount();
  const stranger = await harness.newAccount();

  const created = await createDomain(owner.sub, 'private.com');

  const read = await call(harness, stranger.sub, 'GET', `/api/domains/${created.id}`);
  const verify = await call(harness, stranger.sub, 'POST', `/api/domains/${created.id}/verify`);
  const removed = await call(harness, stranger.sub, 'DELETE', `/api/domains/${created.id}`);

  expect([read.status, verify.status, removed.status]).toEqual([404, 404, 404]);
});

it('does not list domains belonging to another account', async () => {
  const owner = await harness.newAccount();
  const stranger = await harness.newAccount();

  await createDomain(owner.sub, 'mine-only.com');

  const listed = await call<DomainResponse[]>(harness, stranger.sub, 'GET', '/api/domains');

  expect(listed.body).toEqual([]);
});

it('refuses to verify while the challenge record is absent', async () => {
  const { sub } = await harness.newAccount();
  const created = await createDomain(sub, 'unpublished.com');

  const result = await call(harness, sub, 'POST', `/api/domains/${created.id}/verify`);

  expect(result.status).toBe(409);

  const [row] = await harness.db.select().from(domain).where(eq(domain.id, created.id));
  expect(row?.verifiedAt).toBeNull();
});

it('refuses to verify when the published token belongs to a different domain', async () => {
  const { sub } = await harness.newAccount();
  const created = await createDomain(sub, 'wrong-token.com');

  txt.mockResolvedValue(['stampyx-verify=some-other-accounts-token']);

  const result = await call(harness, sub, 'POST', `/api/domains/${created.id}/verify`);

  expect(result.status).toBe(409);
});

it('verifies once the challenge record is published, and is idempotent after that', async () => {
  const { sub } = await harness.newAccount();
  const created = await createDomain(sub, 'published.com');

  const [row] = await harness.db.select().from(domain).where(eq(domain.id, created.id));
  const token = row?.verificationToken ?? '';

  txt.mockImplementation((name: string) =>
    Promise.resolve(name === `${CHALLENGE_PREFIX}.published.com` ? [token] : []),
  );

  const first = await call<DomainResponse>(
    harness,
    sub,
    'POST',
    `/api/domains/${created.id}/verify`,
  );
  expect(first.status).toBe(200);
  expect(first.body.verified).toBe(true);

  const second = await call<DomainResponse>(
    harness,
    sub,
    'POST',
    `/api/domains/${created.id}/verify`,
  );
  expect(second.status).toBe(200);
  expect(second.body.verifiedAt).toBe(first.body.verifiedAt);
});

it('reports every DNS record as missing when nothing is published', async () => {
  const { sub } = await harness.newAccount();
  const created = await createDomain(sub, 'bare.com');

  const report = await call<{ allOk: boolean; checks: { name: string; status: string }[] }>(
    harness,
    sub,
    'GET',
    `/api/domains/${created.id}/dns-check`,
  );

  expect(report.body.allOk).toBe(false);
  expect(report.body.checks.map((check) => check.name)).toEqual([
    'SPF',
    'DKIM',
    'DMARC',
    'MX',
    'PTR',
  ]);
  expect(report.body.checks.every((check) => check.status === 'missing')).toBe(true);
});

it('rejects a name that is not a fully-qualified domain', async () => {
  const { sub } = await harness.newAccount();

  for (const name of ['localhost', 'not a domain', '-leading.com', 'trailing-.com']) {
    const result = await call(harness, sub, 'POST', '/api/domains', { name });

    expect(result.status, name).toBe(400);
  }
});

it('refuses an account that has not been approved yet', async () => {
  const { sub } = await harness.newAccount('pending');

  const result = await call(harness, sub, 'GET', '/api/domains');

  expect(result.status).toBe(403);
});

it('refuses a suspended account', async () => {
  const { sub } = await harness.newAccount('suspended');

  const result = await call(harness, sub, 'GET', '/api/domains');

  expect(result.status).toBe(403);
});

it('refuses a token whose subject has no account at all', async () => {
  const result = await call(harness, '00000000-0000-4000-8000-000000000000', 'GET', '/api/domains');

  expect(result.status).toBe(401);
});
