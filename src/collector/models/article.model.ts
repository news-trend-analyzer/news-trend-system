/**
 * RSS 파싱 결과 아이템
 */
export interface ParsedRssItem {
  title: string;
  link: string;
  pubDate: string | null;
  description: string | null;
}

/**
 * 수집된 기사 정보
 */
export interface Article extends ParsedRssItem {
  press: string;
  category: string;
  collectedAt: string;
}

/**
 * 스크래핑 대상 기사 정보
 */
export interface NewsArticle {
  title: string;
  link: string;
  press: string;
  category: string;
  contentBody?: string;
}

/**
 * 스크래핑 결과
 */
export interface ScrapedArticle extends NewsArticle {
  contentBody: string;
  crawledAt: string;
}



