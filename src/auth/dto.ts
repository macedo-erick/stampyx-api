import { z } from 'zod';

const password = z.string().min(12).max(200);

export const mailboxLoginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(320),
  password: z.string().min(1).max(200),
});
export type MailboxLoginRequest = z.infer<typeof mailboxLoginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(200) });
export type RefreshRequest = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export interface MailboxSessionResponse {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly address: string;
}
