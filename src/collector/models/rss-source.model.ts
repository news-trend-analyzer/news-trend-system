/**
 * RSS 피드 정보
 */
export interface RssFeed {
  [category: string]: string;
}

/**
 * 언론사 RSS 소스 정보
 */
export interface RssSource {
  name: string;
  feeds: RssFeed;
}

/**
 * RSS 소스 맵
 */
export interface RssSourceMap {
  [key: string]: RssSource;
}



