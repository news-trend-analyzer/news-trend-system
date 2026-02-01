import { IsInt, IsNotEmpty, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetRankingDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  recentBuckets?: number = 12;

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