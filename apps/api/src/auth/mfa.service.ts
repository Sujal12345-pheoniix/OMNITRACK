import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { randomBytes } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { decrypt, encrypt, sha256 } from '../common/crypto';

authenticator.options = { window: 1, step: 30, digits: 6 };

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** TOTP (RFC 6238) with encrypted secrets, replay protection and one-time recovery codes. */
@Injectable()
export class MfaService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  newSecret(): string {
    return authenticator.generateSecret(20);
  }

  otpauthUrl(email: string, secret: string): string {
    return authenticator.keyuri(email, 'OmniTrack', secret);
  }

  encryptSecret(secret: string): string {
    return encrypt(secret, this.env.MFA_ENCRYPTION_KEY);
  }

  decryptSecret(enc: string): string {
    return decrypt(enc, this.env.MFA_ENCRYPTION_KEY);
  }

  /**
   * Returns the matched time step, or null. A step at or before `lastUsedStep` is rejected
   * so an intercepted code cannot be replayed.
   */
  verify(secret: string, code: string, lastUsedStep: number | null): number | null {
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) return null;
    const step = Math.floor(Date.now() / 1000 / 30) + delta;
    if (lastUsedStep !== null && step <= lastUsedStep) return null;
    return step;
  }

  /** For tests and tooling: the current code for a secret. */
  currentCode(secret: string): string {
    return authenticator.generate(secret);
  }

  recoveryCodes(count = 10): { plain: string[]; hashes: string[] } {
    const plain = Array.from({ length: count }, () => {
      const bytes = randomBytes(10);
      const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
      return `${chars.slice(0, 5)}-${chars.slice(5)}`;
    });
    return { plain, hashes: plain.map((p) => sha256(p)) };
  }
}
