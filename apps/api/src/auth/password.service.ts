import { Inject, Injectable, Logger } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { Errors } from '../common/errors';

/**
 * OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1). Argon2id is the library default.
 */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

/**
 * A small built-in deny-list of the most common passwords of 12+ characters. The full
 * breached-password check uses the Have I Been Pwned k-anonymity range API when
 * HIBP_ENABLED=true (only the first 5 hex characters of the SHA-1 leave the server).
 */
const COMMON = new Set([
  'password1234', 'password12345', 'password123456', '123456789012', '1234567890123',
  'qwertyuiop12', 'qwerty123456', 'iloveyou1234', 'administrator', 'welcome12345',
  'letmein12345', 'passw0rd1234', 'abcdefghijkl', 'aaaaaaaaaaaa', '111111111111',
  'changeme1234', 'omnitrack123', 'omnitrack1234', 'p@ssword1234', 'password@123',
  'qwertyuiopasdf', 'monkey123456', 'football1234', 'baseball1234', 'superman1234',
]);

@Injectable()
export class PasswordService {
  private readonly logger = new Logger('PasswordService');
  /** Used to equalize timing when the account does not exist. */
  private dummyHash: Promise<string> | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  hash(password: string): Promise<string> {
    return hash(password, ARGON2);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    if (!passwordHash) {
      this.dummyHash ??= hash('timing-equalizer-not-a-real-password', ARGON2);
      await verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Throws PASSWORD_BREACHED for known-compromised or trivially guessable passwords. */
  async assertNotBreached(password: string, context: string[] = []): Promise<void> {
    const lower = password.toLowerCase();
    if (COMMON.has(lower) || /^(.)\1+$/.test(password)) throw this.breached();
    for (const word of context) {
      const w = word.toLowerCase().trim();
      if (w.length >= 4 && lower.includes(w)) {
        throw Errors.rule('PASSWORD_WEAK', 'Your password must not contain your name, email or organization.');
      }
    }
    if (!this.env.HIBP_ENABLED) return;
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'omnitrack-password-check' },
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok) return;
      const suffix = sha1.slice(5);
      const body = await res.text();
      if (body.split('\n').some((line) => line.startsWith(suffix) && !line.endsWith(':0'))) throw this.breached();
    } catch (err) {
      if ((err as { code?: string }).code === 'PASSWORD_BREACHED') throw err;
      this.logger.warn(`Breached-password service unavailable: ${(err as Error).message}`);
    }
  }

  private breached() {
    return Errors.rule(
      'PASSWORD_BREACHED',
      'This password has appeared in data breaches or is too common. Choose a different one.',
    );
  }
}
