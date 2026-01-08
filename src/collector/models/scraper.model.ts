import { NewsArticle, ScrapedArticle } from './article.model';

/**
 * 스크래핑 결과
 */
export interface ScrapeResult {
  successCount: number;
  failureCount: number;
  outputPath: string;
}

/**
 * 기사 스크래핑 파라미터
 */
export interface ScrapeArticleParams {
  article: NewsArticle;
  index: number;
  total: number;
  outputPath: string;
  selectorMap: Record<string, string[]>;
}





