import { z } from 'zod';

export const setStatusSchema = z.object({
  status: z.enum(['pending', 'active', 'suspended']),
});
export type SetStatusRequest = z.infer<typeof setStatusSchema>;

export const resetPasswordSchema = z.object({ password: z.string().min(12).max(200) });
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

export interface AdminAccountResponse {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly plan: string;
  readonly status: string;
  readonly createdAt: string;
  readonly domainCount: number;
  readonly mailboxCount: number;
}

export interface AdminDomainResponse {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly accountId: string | null;
  readonly accountEmail: string | null;
  readonly verified: boolean;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface AdminMailboxResponse {
  readonly id: string;
  readonly address: string;
  readonly accountId: string;
  readonly accountEmail: string;
  readonly domainKind: string;
  readonly quotaMb: number;
  readonly active: boolean;
  readonly lockedUntil: string | null;
  readonly createdAt: string;
}
