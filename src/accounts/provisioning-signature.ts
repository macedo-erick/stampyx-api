import { createHmac, timingSafeEqual } from 'node:crypto';

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

  if (presented.length !== computed.length) {
    return false;
  }

  return timingSafeEqual(presented, computed);
}
