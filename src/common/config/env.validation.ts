import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
  Min,
  Max,
} from 'class-validator';

/**
 * 환경 변수 검증 스키마
 */
class EnvironmentVariables {
  @IsNotEmpty()
  @IsString()
  NODE_ENV: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  COLLECTOR_PORT?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  TREND_PORT?: number;

  @IsNotEmpty()
  @IsString()
  REDIS_HOST: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Max(15)
  REDIS_DB: number;

  @IsNotEmpty()
  @IsString()
  ELASTICSEARCH_NODE: string;

  @IsOptional()
  @IsString()
  ELASTICSEARCH_USERNAME?: string;

  @IsOptional()
  @IsString()
  ELASTICSEARCH_PASSWORD?: string;

  @IsNotEmpty()
  @IsString()
  ELASTICSEARCH_INDEX_ARTICLES: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  ELASTICSEARCH_PORT?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  KIBANA_PORT?: number;

  @IsOptional()
  @IsString()
  ALLOWED_ORIGINS?: string;

  @IsOptional()
  @IsString()
  ADMIN_API_KEY?: string;

  @IsOptional()
  @IsString()
  ALLOWED_ADMIN_IPS?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  THROTTLE_TTL?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  THROTTLE_LIMIT?: number;

  @IsOptional()
  @IsString()
  ARTICLE_SINK_PATH?: string;

  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @IsOptional()
  @IsString()
  DB_HOST?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  DB_PORT?: number;

  @IsOptional()
  @IsString()
  DB_USERNAME?: string;

  @IsOptional()
  @IsString()
  DB_PASSWORD?: string;

  @IsOptional()
  @IsString()
  DB_DATABASE?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(60)
  BUCKET_MINUTES?: number;
}

/**
 * 환경 변수 검증 함수
 * @param config - 환경 변수 객체
 * @returns 검증된 환경 변수 객체
 */
export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors.map((error) => {
      const constraints = Object.values(error.constraints || {});
      return `${error.property}: ${constraints.join(', ')}`;
    });
    throw new Error(
      `Environment validation failed:\n${errorMessages.join('\n')}`,
    );
  }

  return validatedConfig;
}

