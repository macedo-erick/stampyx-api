export interface KeycloakIdentity {
  readonly kind: 'keycloak';
  readonly sub: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly admin: boolean;
}

export interface MailboxIdentity {
  readonly kind: 'mailbox';
  readonly mailboxId: string;
  readonly accountId: string;
}

export type Identity = KeycloakIdentity | MailboxIdentity;

export type Principal =
  | { readonly kind: 'account'; readonly accountId: string; readonly admin: boolean }
  | { readonly kind: 'mailbox'; readonly accountId: string; readonly mailboxId: string };

export function isAdmin(principal: Principal): boolean {
  return principal.kind === 'account' && principal.admin;
}
