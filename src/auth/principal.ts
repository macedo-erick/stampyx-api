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

// Both arms carry accountId, which is what keeps the ownership contract intact: every service
// and repository still filters by account in SQL, and a mailbox user simply resolves to the
// account that owns their domain. The extra narrowing - that a mailbox principal may only
// touch its own mailbox - is MailboxScopeGuard's job, not the repositories'.
export type Principal =
  | { readonly kind: 'account'; readonly accountId: string; readonly admin: boolean }
  | { readonly kind: 'mailbox'; readonly accountId: string; readonly mailboxId: string };

export function isAdmin(principal: Principal): boolean {
  return principal.kind === 'account' && principal.admin;
}
