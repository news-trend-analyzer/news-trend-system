import { IsNotEmpty, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * 기사 검색 요청 DTO
 */
export class SearchArticlesDto {
  @IsNotEmpty({ message: 'query 파라미터는 필수입니다.' })
  @IsString({ message: 'query는 문자열이어야 합니다.' })
  query: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page는 정수여야 합니다.' })
  @Min(1, { message: 'page는 1 이상이어야 합니다.' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'from은 정수여야 합니다.' })
  @Min(0, { message: 'from은 0 이상이어야 합니다.' })
  from?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size는 정수여야 합니다.' })
  @Min(1, { message: 'size는 1 이상이어야 합니다.' })
  @Max(50, { message: 'size는 50 이하여야 합니다.' })
  size?: number;
}


