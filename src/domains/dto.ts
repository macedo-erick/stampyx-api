import { z } from 'zod';

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
  readonly dnsRecords?: readonly DnsRecordResponse[];
}

export interface PlatformDomainResponse {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}
