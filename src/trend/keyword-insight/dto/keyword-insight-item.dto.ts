import { Expose } from 'class-transformer';

export class KeywordInsightItemDto {
  @Expose()
  keywordId: number;

  @Expose()
  keyword: string;

  @Expose()
  summary: string | null;

  @Expose()
  articleIds: number[] | null;

  @Expose()
  analyzedAt: Date | null;
}
