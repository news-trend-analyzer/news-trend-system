import { Expose } from 'class-transformer';

export class KeywordInsightDetailDto {
  @Expose()
  keywordId: number;

  @Expose()
  keyword: string;

  @Expose()
  summary: string | null;

  @Expose()
  analyzedAt: Date | null;

  @Expose()
  articleCount: number;

  @Expose()
  briefing: unknown;
}
