import { Injectable } from '@nestjs/common';
import type { Prisma, Tx } from '@omnitrack/db';

export interface EmailMessage {
  to: string;
  template:
    | 'verify_email'
    | 'password_reset'
    | 'password_changed'
    | 'account_exists'
    | 'invitation'
    | 'mfa_changed'
    | 'notification';
  data: Record<string, string>;
}

/**
 * Transactional outbox (ADR-011). Events are inserted in the business transaction and
 * delivered by the worker after commit, so a rolled-back change never sends an email.
 * The app role may only INSERT here (it cannot read payloads back), hence createMany.
 */
@Injectable()
export class OutboxService {
  async email(tx: Tx, organizationId: string | null, message: EmailMessage): Promise<void> {
    await this.publish(tx, organizationId, 'email.send', message as unknown as Prisma.InputJsonValue);
  }

  async publish(tx: Tx, organizationId: string | null, type: string, payload: Prisma.InputJsonValue): Promise<void> {
    await tx.outboxEvent.createMany({ data: [{ organizationId, type, payload }] });
  }
}
