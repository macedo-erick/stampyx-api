import { dkimRecordValue } from './dkim';
import type { DnsLookups } from './dns.resolver';

export const CHALLENGE_PREFIX = '_stampyx-challenge';

export type CheckStatus = 'ok' | 'missing' | 'mismatch';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly expected: string;
  readonly found: string | null;
}

export interface DnsCheckReport {
  readonly domain: string;
  readonly checks: readonly CheckResult[];
  readonly allOk: boolean;
}

export interface DnsCheckInput {
  readonly domain: string;
  readonly dkimSelector: string;
  readonly dkimPublicKey: string;
  readonly mailHostname: string;
  readonly publicIp: string;
}

export function requiredRecords(input: DnsCheckInput, verificationToken: string) {
  return [
    {
      type: 'TXT',
      host: `${CHALLENGE_PREFIX}.${input.domain}`,
      value: verificationToken,
      purpose: 'Proves you control this domain. Required before the domain can send or receive.',
    },
    {
      type: 'MX',
      host: input.domain,
      value: `10 ${input.mailHostname}`,
      purpose: 'Routes inbound mail for this domain to this server.',
    },
    {
      type: 'TXT',
      host: input.domain,
      value: `v=spf1 ip4:${input.publicIp} -all`,
      purpose: 'Authorises this server to send as this domain.',
    },
    {
      type: 'TXT',
      host: `${input.dkimSelector}._domainkey.${input.domain}`,
      value: dkimRecordValue(input.dkimPublicKey),
      purpose: 'Lets receivers verify the signature on every message you send.',
    },
    {
      type: 'TXT',
      host: `_dmarc.${input.domain}`,
      // p=quarantine, not reject: during warmup you want reports, not hard bounces.
      value: 'v=DMARC1; p=quarantine; rua=mailto:',
      purpose: 'Tells receivers what to do when SPF and DKIM disagree, and where to report.',
    },
  ] as const;
}

export async function runDnsCheck(dns: DnsLookups, input: DnsCheckInput): Promise<DnsCheckReport> {
  const [apexTxt, dkimTxt, dmarcTxt, mx, ptr] = await Promise.all([
    dns.txt(input.domain),
    dns.txt(`${input.dkimSelector}._domainkey.${input.domain}`),
    dns.txt(`_dmarc.${input.domain}`),
    dns.mx(input.domain),
    dns.reverse(input.publicIp),
  ]);

  const checks: CheckResult[] = [
    checkSpf(apexTxt, input.publicIp),
    checkDkim(dkimTxt, input.dkimPublicKey),
    checkDmarc(dmarcTxt),
    checkMx(mx, input.mailHostname),
    checkPtr(ptr, input.mailHostname),
  ];

  return {
    domain: input.domain,
    checks,
    allOk: checks.every((check) => check.status === 'ok'),
  };
}

function checkSpf(records: string[], publicIp: string): CheckResult {
  const expected = `v=spf1 ip4:${publicIp} -all`;
  const spf = records.find((record) => record.toLowerCase().startsWith('v=spf1'));

  if (spf === undefined) {
    return { name: 'SPF', status: 'missing', expected, found: null };
  }

  // Not a string compare: include:, extra ip4 blocks and a different `all` are all valid.
  const authorised = spf.includes(`ip4:${publicIp}`);

  return { name: 'SPF', status: authorised ? 'ok' : 'mismatch', expected, found: spf };
}

function checkDkim(records: string[], publicKey: string): CheckResult {
  const expected = dkimRecordValue(publicKey);
  const dkim = records.find((record) => record.includes('p='));

  if (dkim === undefined) {
    return { name: 'DKIM', status: 'missing', expected, found: null };
  }

  // Key material only: providers vary tag order and spacing, and several rewrite on save.
  const found = /p=([A-Za-z0-9+/=]+)/.exec(dkim)?.[1] ?? null;

  return {
    name: 'DKIM',
    status: found === publicKey ? 'ok' : 'mismatch',
    expected,
    found: dkim,
  };
}

function checkDmarc(records: string[]): CheckResult {
  const expected = 'v=DMARC1; p=quarantine; rua=mailto:...';
  const dmarc = records.find((record) => record.toLowerCase().startsWith('v=dmarc1'));

  if (dmarc === undefined) {
    return { name: 'DMARC', status: 'missing', expected, found: null };
  }

  return { name: 'DMARC', status: 'ok', expected, found: dmarc };
}

function checkMx(records: { exchange: string; priority: number }[], hostname: string): CheckResult {
  const expected = `10 ${hostname}`;

  if (records.length === 0) {
    return { name: 'MX', status: 'missing', expected, found: null };
  }

  const found = records
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((record) => `${String(record.priority)} ${record.exchange}`)
    .join(', ');

  const points = records.some((record) => sameHost(record.exchange, hostname));

  return { name: 'MX', status: points ? 'ok' : 'mismatch', expected, found };
}

// Set in the VPS provider's panel, not the domain's DNS, so it survives getting everything
// else right.
function checkPtr(names: string[], hostname: string): CheckResult {
  if (names.length === 0) {
    return { name: 'PTR', status: 'missing', expected: hostname, found: null };
  }

  const matches = names.some((name) => sameHost(name, hostname));

  return {
    name: 'PTR',
    status: matches ? 'ok' : 'mismatch',
    expected: hostname,
    found: names.join(', '),
  };
}

function sameHost(a: string, b: string): boolean {
  return a.replace(/\.$/, '').toLowerCase() === b.replace(/\.$/, '').toLowerCase();
}
