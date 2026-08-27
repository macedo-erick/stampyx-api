export function suggestAddress(
  email: string,
  offered: readonly { id: string; name: string }[],
): { localPart: string; domainId: string } | null {
  const at = email.lastIndexOf('@');

  if (at <= 0 || offered.length === 0) {
    return null;
  }

  const localPart = email
    .slice(0, at)
    .toLowerCase()
    .replace(/[^a-z0-9.!#$%&'*+/=?^_`{|}~-]/g, '')
    .slice(0, 64);

  if (localPart === '') {
    return null;
  }

  const domain = email.slice(at + 1).toLowerCase();
  const matched = offered.find((row) => row.name === domain) ?? offered[0];

  return matched === undefined ? null : { localPart, domainId: matched.id };
}
