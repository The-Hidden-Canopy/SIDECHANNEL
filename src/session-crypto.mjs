import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export const ENCRYPTED_SESSION_FORMAT = 'sidechannel-encrypted-session';
export const ENCRYPTED_SESSION_VERSION = '0.1';
const CIPHER = 'aes-256-gcm';
const AAD = Buffer.from('sidechannel-session/1', 'utf8');
const KDF = Object.freeze({ name: 'scrypt', N: 16384, r: 8, p: 1, keyLength: 32 });
const MAX_PASSPHRASE_BYTES = 512;
const MAX_CIPHERTEXT_BYTES = 20 * 1024 * 1024;

function cryptoError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function passphraseBuffer(passphrase) {
  if (typeof passphrase !== 'string') throw cryptoError('PASSPHRASE_REQUIRED', 'a passphrase is required');
  const value = Buffer.from(passphrase, 'utf8');
  if (value.length < 8) throw cryptoError('PASSPHRASE_TOO_SHORT', 'passphrase must be at least 8 bytes');
  if (value.length > MAX_PASSPHRASE_BYTES) throw cryptoError('PASSPHRASE_TOO_LONG', 'passphrase exceeds the maximum length');
  return value;
}

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, KDF.keyLength, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    maxmem: 64 * 1024 * 1024
  });
}

function base64(value) {
  return Buffer.from(value).toString('base64');
}

function decodeBase64(value, field, maxBytes) {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(maxBytes * 4 / 3) + 8) {
    throw cryptoError('ENVELOPE_INVALID', field + ' is missing or exceeds its bound');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.length > maxBytes) throw cryptoError('ENVELOPE_INVALID', field + ' is invalid or exceeds its bound');
  return decoded;
}

export function encryptSessionPackage(packageData, passphrase, { salt = randomBytes(16), iv = randomBytes(12) } = {}) {
  const secret = passphraseBuffer(passphrase);
  if (!packageData || packageData.format !== 'sidechannel-session') {
    throw cryptoError('PACKAGE_INVALID', 'only a SIDECHANNEL session package can be encrypted');
  }
  if (!Buffer.isBuffer(salt) || salt.length !== 16 || !Buffer.isBuffer(iv) || iv.length !== 12) {
    throw cryptoError('ENVELOPE_INVALID', 'encryption salt or iv has an invalid length');
  }
  const plaintext = Buffer.from(JSON.stringify(packageData), 'utf8');
  if (plaintext.length > MAX_CIPHERTEXT_BYTES) throw cryptoError('PACKAGE_TOO_LARGE', 'session package exceeds the encryption bound');
  const cipher = createCipheriv(CIPHER, deriveKey(secret, salt), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: ENCRYPTED_SESSION_FORMAT,
    formatVersion: ENCRYPTED_SESSION_VERSION,
    algorithm: CIPHER,
    aad: AAD.toString('utf8'),
    kdf: { ...KDF, salt: base64(salt) },
    iv: base64(iv),
    authTag: base64(cipher.getAuthTag()),
    ciphertext: base64(ciphertext),
    sessionId: packageData.sessionId || null,
    packageDigest: packageData.packageDigest || null
  };
}

export function decryptSessionPackage(envelope, passphrase) {
  const secret = passphraseBuffer(passphrase);
  if (!envelope || envelope.format !== ENCRYPTED_SESSION_FORMAT || envelope.formatVersion !== ENCRYPTED_SESSION_VERSION ||
      envelope.algorithm !== CIPHER || envelope.aad !== AAD.toString('utf8')) {
    throw cryptoError('ENVELOPE_INVALID', 'unsupported encrypted session envelope');
  }
  if (!envelope.kdf || envelope.kdf.name !== KDF.name || envelope.kdf.N !== KDF.N || envelope.kdf.r !== KDF.r ||
      envelope.kdf.p !== KDF.p || envelope.kdf.keyLength !== KDF.keyLength) {
    throw cryptoError('ENVELOPE_INVALID', 'unsupported encrypted session key-derivation parameters');
  }
  const salt = decodeBase64(envelope.kdf.salt, 'salt', 16);
  const iv = decodeBase64(envelope.iv, 'iv', 12);
  const authTag = decodeBase64(envelope.authTag, 'authTag', 16);
  const ciphertext = decodeBase64(envelope.ciphertext, 'ciphertext', MAX_CIPHERTEXT_BYTES);
  try {
    const decipher = createDecipheriv(CIPHER, deriveKey(secret, salt), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const packageData = JSON.parse(plaintext.toString('utf8'));
    if (!packageData || packageData.format !== 'sidechannel-session') {
      throw cryptoError('PACKAGE_INVALID', 'decrypted content is not a SIDECHANNEL session package');
    }
    return packageData;
  } catch (error) {
    if (error.code === 'PACKAGE_INVALID') throw error;
    throw cryptoError('AUTH_FAILED', 'encrypted session authentication failed');
  }
}
