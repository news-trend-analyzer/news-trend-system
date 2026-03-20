import { Exclude } from 'class-transformer';

/**
 * 실시간 트렌드 키워드 응답 DTO
 * @Exclude()로 id는 직렬화 시 응답에서 제외 (보안)
 */
export class RealtimeTrendItemDto {
  @Exclude()
  id: number;

  normalizedText: string;
  displayText: string | null;
  type: string | null;
  createdAt: Date | null;
  score24h: number;
  scoreRecent: number;
  scorePrev: number;
  diffScore: number;
  finalScore: number;
}
