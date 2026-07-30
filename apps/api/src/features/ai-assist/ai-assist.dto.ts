import { IsString, IsBoolean } from 'class-validator';

export class StartExtractionDto {
  @IsString()
  policyId!: string;
}

export class SetDocumentExclusionDto {
  @IsString()
  documentId!: string;

  @IsBoolean()
  excluded!: boolean;
}

export class AiHealthCheckResponseDto {
  @IsBoolean()
  connected!: boolean;

  @IsString()
  provider!: string;
}
