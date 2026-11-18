import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, randomToken, safeEqual, sha256, uuidv7 } from './crypto';

describe('crypto helpers', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips AES-GCM and rejects tampering', () => {
    const ct = encrypt('JBSWY3DPEHPK3PXP', key);
    expect(decrypt(ct, key)).toBe('JBSWY3DPEHPK3PXP');
    const [iv, body, tag] = ct.split('.');
    const flipped = Buffer.from(body!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decrypt([iv, flipped.toString('base64url'), tag].join('.'), key)).toThrow();
  });

  it('rejects decryption with another key', () => {
    const ct = encrypt('secret', key);
    expect(() => decrypt(ct, randomBytes(32).toString('base64'))).toThrow();
  });

  it('generates distinct high-entropy tokens', () => {
    const a = randomToken();
    expect(a).toHaveLength(43);
    expect(a).not.toBe(randomToken());
  });

  it('hashes deterministically and compares in constant time', () => {
    expect(sha256('x')).toBe(sha256('x'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('produces valid, time-ordered UUIDv7 values', () => {
    const ids = Array.from({ length: 5 }, () => uuidv7());
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const later = (() => {
      const start = Date.now();
      while (Date.now() === start) {
        /* wait for the next millisecond */
      }
      return uuidv7();
    })();
    expect(later > ids[0]!).toBe(true);
  });
});
