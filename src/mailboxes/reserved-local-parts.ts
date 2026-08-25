// postmaster and abuse are required by RFC 2142; the rest is what a brand uses on its own
// apex. Consumer addresses live on that same apex, so anything here would otherwise be
// claimable by whoever signs up first.
const RESERVED = new Set([
  'postmaster',
  'abuse',
  'hostmaster',
  'webmaster',
  'dmarc',
  'admin',
  'administrator',
  'root',
  'security',
  'noreply',
  'no-reply',
  'nao-responda',
  'mailer-daemon',
  'support',
  'suporte',
  'contato',
  'contact',
  'billing',
  'faturamento',
  'info',
  'help',
  'ajuda',
  'stampyx',
]);

export function isReservedLocalPart(localPart: string): boolean {
  return RESERVED.has(localPart.toLowerCase());
}
