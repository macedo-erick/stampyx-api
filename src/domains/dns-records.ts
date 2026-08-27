import type { Config } from '../config';
import type { Domain } from '../database/schema';
import { publicKeyOf } from './dkim';
import { CHALLENGE_PREFIX, type DnsCheckInput, requiredRecords } from './dns-check';
import type { DnsRecordResponse } from './dto';

export function checkInputFor(row: Domain, config: Config): DnsCheckInput {
  return {
    domain: row.name,
    dkimSelector: row.dkimSelector,
    dkimPublicKey: publicKeyOf(row.dkimPrivateKey),
    mailHostname: config.MAIL_HOSTNAME,
    publicIp: config.MAIL_PUBLIC_IP,
  };
}

export function dnsRecordsFor(row: Domain, config: Config): DnsRecordResponse[] {
  return (
    requiredRecords(checkInputFor(row, config), row.verificationToken)
      // Seeded verified, so no challenge: it would be proving control of our own domain to ourselves.
      .filter((record) => row.kind !== 'platform' || !record.host.startsWith(CHALLENGE_PREFIX))
      .map((record) => ({
        ...record,
        value:
          record.type === 'TXT' && record.host.startsWith('_dmarc')
            ? `v=DMARC1; p=quarantine; rua=mailto:${config.DMARC_REPORT_EMAIL}`
            : record.value,
      }))
  );
}
