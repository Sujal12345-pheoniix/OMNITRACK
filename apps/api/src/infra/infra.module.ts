import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { OutboxService } from './outbox.service';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, AuditService, OutboxService],
  exports: [PrismaService, RedisService, AuditService, OutboxService],
})
export class InfraModule {}
