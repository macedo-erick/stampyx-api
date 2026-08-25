import { z } from 'zod';

// A domain is a globally unique claim here, so a plausible-looking value is not enough.
export const createDomainSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(253)
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
      'must be a fully-qualified domain name',
    ),
});
export type CreateDomainRequest = z.infer<typeof createDomainSchema>;

export interface DnsRecordResponse {
  readonly type: string;
  readonly host: string;
  readonly value: string;
  readonly purpose: string;
}

export interface DomainResponse {
  readonly id: string;
  readonly name: string;
  readonly dkimSelector: string;
  readonly verified: boolean;
  readonly verifiedAt: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  // Present on create and GET-one, for the copy-ready records panel.
  readonly dnsRecords?: readonly DnsRecordResponse[];
}

export interface PlatformDomainResponse {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}
