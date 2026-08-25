import { z } from 'zod';

import type { MailboxResponse } from '../mailboxes/dto';

const localPart = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/,
    'must be a valid mailbox name',
  );

export const claimAddressSchema = z.object({ localPart, domainId: z.uuid() });
export type ClaimAddressRequest = z.infer<typeof claimAddressSchema>;

export const availabilitySchema = z.object({ localPart, domainId: z.uuid() });
export type AvailabilityQuery = z.infer<typeof availabilitySchema>;

export interface AvailabilityResponse {
  readonly available: boolean;
}

// What the panel needs to decide which product surface to draw, in one call.
export interface MeResponse {
  readonly kind: 'account' | 'mailbox';
  readonly admin: boolean;
  readonly displayName: string | null;
  readonly loginEmail: string | null;
  readonly mailboxes: readonly MailboxResponse[];
  readonly platformAddress: string | null;
  // An account with no address on a platform domain yet, while one is on offer.
  readonly needsAddress: boolean;
  // Derived from the address they registered with, so someone who signed up as
  // erick@stampyx.com is offered exactly that rather than an empty field.
  readonly suggestedLocalPart: string | null;
  readonly suggestedDomainId: string | null;
}
