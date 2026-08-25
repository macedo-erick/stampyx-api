import { z } from 'zod';

export const provisioningEventSchema = z.object({
  userId: z.uuid(),
  realm: z.string().min(1),
  timestamp: z.number().int().positive(),
});
export type ProvisioningEvent = z.infer<typeof provisioningEventSchema>;

export interface AccountResponse {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly plan: string;
  readonly status: string;
  readonly createdAt: string;
}
