import { IsNotEmpty, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 키워드로 기사 검색 요청 DTO
 */
export class SearchArticlesByKeywordDto {
  @IsNotEmpty({ message: 'keyword 파라미터는 필수입니다.' })
  @IsString({ message: 'keyword는 문자열이어야 합니다.' })
  keyword: string;

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
