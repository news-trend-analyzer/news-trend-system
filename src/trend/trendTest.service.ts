import { Injectable } from '@nestjs/common';

@Injectable()
export class TrendAnalysisService {
  private readonly STOP_WORDS = [
    '기자', '보도', '관련', '이번', '대한', '통해', '에서',
    '으로', '했다', '한다', '있는', '그리고', '하지만',
    '등', '있다', '연합뉴스', '뉴스', '사진', '제공',
    '가능성', '상황', '문제', '이슈', '내용', '기술', '오늘',
  ];

  // ==================================================
  // 외부 진입 포인트
  // ==================================================
  analyzeTrend(data: { title: string; content_body: string }) {
    const { title, content_body } = data;

    // A. 키워드 전처리 및 복합키 생성
    const compositeKey = this.createCompositeKey(title, content_body);

    // 점수 계산 (본문 등장 횟수 기반)
    const score = this.calculateScore(title, content_body);

    return {
      title,
      compositeKey,
      score,
      keywords: this.extractTop2Keywords(title, content_body),
    };
  }

  // ==================================================
  // A. 키워드 전처리 및 복합키 생성
  // ==================================================

  /**
   * 조사 제거 (단어 끝에만 적용)
   */
  private removeParticles(text: string): string {
    // 단어 끝에 있는 조사만 제거 (단어 경계 사용)
    return text.replace(/(은|는|이|가|을|를|의|에|로|와|과|도)(?=\s|$)/g, '');
  }

  /**
   * 토큰화 및 전처리
   */
  private tokenize(text: string): string[] {
    // 띄어쓰기 기준으로 먼저 분리
    const tokens = text
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length > 0);

    // 각 토큰에서 조사 제거 (단어 끝에만)
    const cleanedTokens = tokens
      .map(t => this.removeParticles(t))
      .filter(t => t.length > 1 && !this.STOP_WORDS.includes(t)); // 1글자 제외, 불용어 제거

    return cleanedTokens;
  }

  /**
   * 본문에서 키워드 등장 횟수 계산
   */
  private countInBody(keyword: string, bodyTokens: string[]): number {
    return bodyTokens.filter(t => t.includes(keyword) || keyword.includes(t)).length;
  }

  /**
   * 제목에서 핵심 키워드 2개 추출
   */
  private extractTop2Keywords(title: string, contentBody: string): string[] {
    const titleTokens = this.tokenize(title);
    const bodyTokens = this.tokenize(contentBody);

    if (titleTokens.length === 0) return [];

    // 제목 키워드별 본문 등장 횟수 계산
    const keywordScores = titleTokens.map(keyword => ({
      keyword,
      count: this.countInBody(keyword, bodyTokens),
    }));

    // 등장 횟수 기준 정렬 (내림차순)
    keywordScores.sort((a, b) => b.count - a.count);

    // 상위 2개 추출 (부족하면 있는 만큼만)
    const top2 = keywordScores.slice(0, 2).map(item => item.keyword);

    return top2;
  }

  /**
   * 복합키 생성 (가나다순 정렬 후 콜론으로 결합)
   */
  private createCompositeKey(title: string, contentBody: string): string {
    const keywords = this.extractTop2Keywords(title, contentBody);

    if (keywords.length === 0) return '';

    // 가나다순 정렬
    const sorted = [...keywords].sort();

    // 콜론으로 결합
    return sorted.join(':');
  }

  /**
   * 점수 계산 (본문 등장 횟수 기반)
   */
  private calculateScore(title: string, contentBody: string): number {
    const keywords = this.extractTop2Keywords(title, contentBody);
    const bodyTokens = this.tokenize(contentBody);

    return keywords.reduce((sum, kw) => sum + this.countInBody(kw, bodyTokens), 0);
  }
}
