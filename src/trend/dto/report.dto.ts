import { IsInt, IsNotEmpty, IsOptional, Max, Min, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class GetRankingDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  recentBuckets?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 5;
}

export class GetTimeSeriesDto {
  @IsNotEmpty()
  @IsInt()
  keywordId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 5;
}

export class GetRelatedArticlesDto {
  @IsNotEmpty()
  @IsInt()
  keywordId: number;
}

export class GetRelatedKeywordsDto {
  @IsNotEmpty()
  @IsInt()
  keywordId: number;
}

export class SearchKeywordDto {
  @IsNotEmpty()
  @IsString({ message: 'keyword는 문자열이어야 합니다.' })
  keyword: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}