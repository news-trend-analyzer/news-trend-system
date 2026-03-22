export type TopKeyword = {
  id: number;
  normalizedText: string;
  freqSum: number;
  scoreSum: number;
};

/** 24h 상위 트렌드: 복합 키워드 유사도 병합 후 대표 행 */
export type RankedKeyword = {
  id: number;
  normalizedText: string;
  displayText: string | null;
  /** 병합 그룹 기준 24시간 score_sum 합 */
  score24h: number;
};

export type RealtimeKeyword = {
  id: number;
  normalizedText: string;
  displayText: string | null;
  type: 'SINGLE' | 'COMPOSITE' | null;
  createdAt: Date | null;
  score24h: number;
  scoreRecent: number;
  scorePrev: number;
  diffScore: number;
  finalScore: number;
};
