import { createHmac, timingSafeEqual } from 'node:crypto';

// Named for planelyx, which ships it: renaming means hand-editing eventsListeners on every realm.
export const PROVISIONING_SIGNATURE_HEADER = 'x-planelyx-signature';

export function verifyProvisioningSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (header === undefined) {
    return false;
  }

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const presented = Buffer.from(header, 'utf8');
  const computed = Buffer.from(expected, 'utf8');

  // timingSafeEqual throws on a length mismatch; === would leak how much was right.
  if (presented.length !== computed.length) {
    return false;
  }

  return timingSafeEqual(presented, computed);
}
