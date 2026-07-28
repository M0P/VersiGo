import { Global, Module } from '@nestjs/common';
import { ConfigFoundationModule } from '../config/config.module';
import { DatabaseService } from './database.service';

@Global()
@Module({
  imports: [ConfigFoundationModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
