import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AccessModule } from './access/access.module';
import { AuditModule } from './audit/audit.controller';
import { AccessGuard } from './auth/access.guard';
import { AuthModule } from './auth/auth.module';
import { ProblemFilter } from './common/problem.filter';
import { ENV, type Env } from './config/env';
import { HealthModule } from './health/health.controller';
import { InfraModule } from './infra/infra.module';
import { PeopleModule } from './people/people.module';
import { TenancyModule } from './tenancy/tenancy.module';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

@Module({})
export class AppModule {
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            genReqId: (req: IncomingMessage, res) => {
              const incoming = req.headers['x-request-id'];
              const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
              res.setHeader('X-Request-Id', id);
              return id;
            },
            // Never log credentials, cookies or tokens (NFR-OBS-001).
            redact: {
              paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
              censor: '[REDACTED]',
            },
            customProps: (req: IncomingMessage & { principal?: { userId: string; organizationId: string | null } | null }) => ({
              userId: req.principal?.userId,
              organizationId: req.principal?.organizationId,
            }),
            autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
            ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
          },
        }),
        InfraModule,
        AccessModule,
        AuthModule,
        TenancyModule,
        PeopleModule,
        AuditModule,
        HealthModule,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: APP_GUARD, useExisting: AccessGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
      exports: [ENV],
    };
  }
}
