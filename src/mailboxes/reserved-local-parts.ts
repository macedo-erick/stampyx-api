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
