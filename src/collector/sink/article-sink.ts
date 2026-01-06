import { Article } from '../models/article.model';

/**
 * 기사 저장 인터페이스
 * 다양한 저장소 구현체가 이 인터페이스를 구현할 수 있음
 */
export interface ArticleSink {
  /**
   * 기사 배열을 저장
   * @param items - 저장할 기사 배열
   */
  save(items: Article[]): Promise<void>;
}

/**
 * NestJS 의존성 주입 토큰
 * DB 교체 시 이 토큰으로 다른 구현을 주입할 수 있음
 */
export const ARTICLE_SINK = 'ARTICLE_SINK';
