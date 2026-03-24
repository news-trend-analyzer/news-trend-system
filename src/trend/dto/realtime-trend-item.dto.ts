import { Expose } from 'class-transformer';

/**
 * 실시간 트렌드 키워드 응답 DTO
 */
export class RealtimeTrendItemDto {
  @Expose()
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
