import { createPublicKey, generateKeyPairSync } from 'node:crypto';

export interface DkimKeyPair {
  readonly privateKeyPem: string;
  readonly publicKeyBase64: string;
}

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

export function publicKeyOf(privateKeyPem: string): string {
  return derBodyOf(createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }));
}
