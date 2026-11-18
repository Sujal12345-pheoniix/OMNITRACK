import type { PrismaClient } from '@omnitrack/db';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';

export const QUEUE_BY_TYPE: Record<string, string> = {
  'email.send': 'email',
};

/**
 * Moves committed outbox events into BullMQ queues. Rows are claimed with
 * FOR UPDATE SKIP LOCKED, so several worker instances can run safely, and the job ID is
 * the outbox ID, so re-relaying after a crash never creates a duplicate job.
 */
export async function relayOnce(db: PrismaClient, queues: Record<string, Queue>, log: Logger, batch = 50): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; type: string; payload: unknown }[]>`
      SELECT id, type, payload FROM outbox_events
      WHERE status = 'pending' AND available_at <= now()
      ORDER BY created_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED`;
    for (const row of rows) {
      const queueName = QUEUE_BY_TYPE[row.type];
      if (!queueName) {
        await tx.$executeRaw`UPDATE outbox_events SET status = 'failed', last_error = ${`no handler for ${row.type}`}, processed_at = now() WHERE id = ${row.id}::uuid`;
        log.error({ outboxId: row.id, type: row.type }, 'No handler for outbox event type');
        continue;
      }
      await queues[queueName]!.add(row.type, { outboxId: row.id, payload: row.payload }, { jobId: row.id });
      await tx.$executeRaw`UPDATE outbox_events SET status = 'enqueued', attempts = attempts + 1 WHERE id = ${row.id}::uuid`;
    }
    return rows.length;
  });
}

/** Marks an event delivered and strips secrets (tokens, links) from its payload. */
export async function markDone(db: PrismaClient, outboxId: string, payload: { to?: string; template?: string }): Promise<void> {
  const redacted = JSON.stringify({ to: payload.to ?? null, template: payload.template ?? null, redacted: true });
  await db.$executeRaw`UPDATE outbox_events SET status = 'done', processed_at = now(), last_error = NULL, payload = ${redacted}::jsonb WHERE id = ${outboxId}::uuid`;
}

export async function markFailed(db: PrismaClient, outboxId: string, error: string): Promise<void> {
  await db.$executeRaw`UPDATE outbox_events SET status = 'failed', processed_at = now(), last_error = ${error.slice(0, 1000)} WHERE id = ${outboxId}::uuid`;
}
