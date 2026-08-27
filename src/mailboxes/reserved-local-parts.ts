// postmaster and abuse are RFC 2142; the rest is what a brand uses on its apex. Consumer
// addresses share that apex, so these would go to whoever signed up first.
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
