/**
 * Technical port for encrypting sensitive settings values.
 * Feature slices (e.g. admin settings) depend only on this interface,
 * never on a concrete implementation.
 */
export interface EncryptionPort {
  encrypt(plainText: string): Promise<string>;
  decrypt(cipherText: string): Promise<string>;
}

export const ENCRYPTION_PORT = Symbol('ENCRYPTION_PORT');
