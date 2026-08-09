import { Module } from '@nestjs/common';
import { LanguageController } from './language.controller';
import { LanguageService } from './language.service';

/**
 * AP-21: language preference for all authenticated roles
 * (inklusive READ_ONLY, sitzungsbezogen).
 */
@Module({
  controllers: [LanguageController],
  providers: [LanguageService],
  exports: [LanguageService],
})
export class LanguageModule {}
