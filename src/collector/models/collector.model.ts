import { Article } from './article.model';

/**
 * RSS 수집 결과
 */
export interface CollectResult {
  savedCount: number;
  took: number;
}

/**
 * XML 처리 파라미터
 */
export interface HandleXmlResultParams {
  pressName: string;
  category: string;
  xml: string | null;
  toSave: Article[];
}

/**
 * RSS 수집 및 스크래핑 통합 결과
 */
export interface CollectAndScrapeResult {
  collect: CollectResult;
  scrape: {
    successCount: number;
    failureCount: number;
    totalTook: number;
  };
}
