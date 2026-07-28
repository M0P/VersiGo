/**
 * Technischer Port fuer Verschluesselung sensitiver Settings-Werte.
 * Feature-Slices (z. B. Admin-Settings) haengen ausschliesslich von
 * diesem Interface ab, niemals von einer konkreten Implementierung.
 */
export interface EncryptionPort {
  encrypt(plainText: string): Promise<string>;
  decrypt(cipherText: string): Promise<string>;
}

export const ENCRYPTION_PORT = Symbol('ENCRYPTION_PORT');
