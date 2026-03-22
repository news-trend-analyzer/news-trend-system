import { Exclude } from 'class-transformer';

/**
 * 트렌드 상위 키워드 응답 DTO
 * @Exclude()로 id는 직렬화 시 응답에서 제외 (보안)
 */
export class TrendItemDto {
  @Exclude()
  id: number;

  rank: number;
  keyword: string;
  status: 'up' | 'down' | 'same' | 'new';
  rankChange: number;
  score24h: number;
}
