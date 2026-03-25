import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * keyword / keywordId 동시 누락 방지 (클래스 검증용)
 */
function RequireKeywordOrKeywordIdConstraint(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    registerDecorator({
      name: 'requireKeywordOrKeywordId',
      target: target.constructor,
      propertyName: propertyKey as string,
      options: validationOptions,
      validator: {
        validate(_: unknown, args: ValidationArguments): boolean {
          const o = args.object as SearchArticlesByKeywordDto;
          const id = o.keywordId;
          const hasId =
            id != null && Number.isInteger(id) && (id as number) >= 1;
          const hasKw =
            typeof o.keyword === 'string' && o.keyword.trim().length > 0;
          return hasId || hasKw;
        },
        defaultMessage(): string {
          return 'keyword 또는 keywordId 중 하나는 필요합니다.';
        },
      },
    });
  };
}

/**
 * 키워드로 기사 검색 요청 DTO
 */
export class SearchArticlesByKeywordDto {
  @RequireKeywordOrKeywordIdConstraint()
  @IsOptional()
  @IsString({ message: 'keyword는 문자열이어야 합니다.' })
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'keywordId는 정수여야 합니다.' })
  @Min(1, { message: 'keywordId는 1 이상이어야 합니다.' })
  keywordId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page는 정수여야 합니다.' })
  @Min(1, { message: 'page는 1 이상이어야 합니다.' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size는 정수여야 합니다.' })
  @Min(1, { message: 'size는 1 이상이어야 합니다.' })
  @Max(50, { message: 'size는 50 이하여야 합니다.' })
  size?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'hoursInterval은 정수여야 합니다.' })
  @Min(1, { message: 'hoursInterval은 1 이상이어야 합니다.' })
  @Max(168, { message: 'hoursInterval은 168(7일) 이하여야 합니다.' })
  hoursInterval?: number;
}
