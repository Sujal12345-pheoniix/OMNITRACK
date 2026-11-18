import { createServer } from 'node:http';
import { createPrismaClient } from '@omnitrack/db';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { loadWorkerEnv } from './env';
import { markDone, markFailed, relayOnce } from './outbox';
import { render, type EmailPayload } from './templates';

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const log = pino({ level: env.LOG_LEVEL, base: { service: 'worker' }, redact: ['payload.data', '*.token', '*.link'] });
  const db = createPrismaClient(env.DATABASE_URL_WORKER);
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const mailer = nodemailer.createTransport(env.SMTP_URL);

  const emailQueue = new Queue('email', {
    connection,
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  });
  const queues = { email: emailQueue };

  const emailWorker = new Worker(
    'email',
    async (job: Job<{ outboxId: string; payload: EmailPayload }>) => {
      const { outboxId, payload } = job.data;
      const message = render(payload);
      await mailer.sendMail({ from: env.EMAIL_FROM, to: payload.to, subject: message.subject, text: message.text, html: message.html });
      await markDone(db, outboxId, payload);
      log.info({ outboxId, template: payload.template }, 'email sent');
    },
    { connection, concurrency: 5 },
  );
  emailWorker.on('failed', (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    log.warn({ outboxId: job.data.outboxId, attempt: job.attemptsMade, final, err: err.message }, 'email delivery failed');
    if (final) void markFailed(db, job.data.outboxId, err.message);
  });

  let healthy = true;
  let stopping = false;
  const loop = async () => {
    while (!stopping) {
      try {
        const n = await relayOnce(db, queues, log);
        healthy = true;
        if (n === 0) await new Promise((r) => setTimeout(r, env.OUTBOX_POLL_MS));
      } catch (err) {
        healthy = false;
        log.error({ err }, 'outbox relay failed');
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  };
  void loop();

  const health = createServer((req, res) => {
    const ok = healthy && connection.status === 'ready';
    res.writeHead(req.url === '/health' && ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ok' : 'degraded', redis: connection.status }));
  }).listen(env.WORKER_HEALTH_PORT);

  log.info({ port: env.WORKER_HEALTH_PORT }, 'worker started');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    stopping = true;
    health.close();
    await emailWorker.close();
    await emailQueue.close();
    connection.disconnect();
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
