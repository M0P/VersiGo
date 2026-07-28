import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config';

/**
 * Zentraler, geteilter Datenbankzugriff fuer API und Worker.
 * Enthaelt ausschliesslich technische Zugriffslogik, keine Fachlogik.
 * Feature-Slices greifen ueber diesen Service auf den Prisma-Client zu,
 * duerfen jedoch keine fachlichen Query-Helfer hier ablegen.
 */
@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({
      datasources: {
        db: { url: config.databaseUrl },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
