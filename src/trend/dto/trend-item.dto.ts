import { Expose } from 'class-transformer';

/**
 * 트렌드 상위 키워드 응답 DTO
 */
export class TrendItemDto {
  @Expose()
  id: number;

  rank: number;
  keyword: string;
  status: 'up' | 'down' | 'same' | 'new';
  rankChange: number;
  score24h: number;
}
