/**
 * LLM 서비스 인터페이스
 * 키워드 트렌드 분석용 "왜 뜨는지" 요약 생성
 */
export type ArticleForInsight = {
  readonly title: string;
  readonly bodySnippet: string;
  readonly publisher: string;
  readonly url: string;
};

export interface LlmService {
  /**
   * 키워드와 관련 기사 본문을 바탕으로 트렌드 원인 요약 생성
   * @param params keyword, articleSummaries
   * @returns LLM 분석 요약 텍스트
   */
  analyzeKeywordTrend(params: {
    keyword: string;
    articleSummaries: readonly ArticleForInsight[];
  }): Promise<string>;
}
