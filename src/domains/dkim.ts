import { createPublicKey, generateKeyPairSync } from 'node:crypto';

export interface DkimKeyPair {
  readonly privateKeyPem: string;
  // The base64 DER body for the `p=` tag, not the PEM.
  readonly publicKeyBase64: string;
}

// RSA 2048, not Ed25519: ed25519-sha256 support is still patchy among large receivers.
export function generateDkimKeyPair(): DkimKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return { privateKeyPem: privateKey, publicKeyBase64: derBodyOf(publicKey) };
}

export function derBodyOf(publicKeyPem: string): string {
  return publicKeyPem
    .split('\n')
    .filter((line) => !line.startsWith('-----') && line.trim() !== '')
    .join('');
}

export function dkimRecordValue(publicKeyBase64: string): string {
  return `v=DKIM1; k=rsa; p=${publicKeyBase64}`;
}

// Only the private key is stored; the public half is derived on demand.
export function publicKeyOf(privateKeyPem: string): string {
  return derBodyOf(createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }));
}
