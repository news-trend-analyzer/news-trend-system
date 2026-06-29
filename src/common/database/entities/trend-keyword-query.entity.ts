import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 랭킹 키워드의 사용자 노출/검색용 표현 스냅샷.
 * 같은 keyword_id라도 시간 구간마다 뉴스 맥락이 달라질 수 있어 별도 이력으로 관리한다.
 */
@Entity('trend_keyword_queries')
@Index('idx_trend_keyword_queries_active', ['windowHours', 'generatedAt', 'expiresAt'])
@Index('idx_trend_keyword_queries_keyword_period', ['keywordId', 'periodStart'])
@Index('uq_trend_keyword_queries_keyword_window_start', ['keywordId', 'windowHours', 'periodStart'], {
  unique: true,
})
export class TrendKeywordQueryEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'keyword_id' })
  keywordId: number;

  @Column({ type: 'int', name: 'window_hours' })
  windowHours: number;

  @Column({ type: 'timestamptz', name: 'period_start' })
  periodStart: Date;

  @Column({ type: 'timestamptz', name: 'period_end' })
  periodEnd: Date;

  @Column({ type: 'int', name: 'rank' })
  rank: number;

  @Column({ type: 'varchar', length: 255, name: 'source_keyword' })
  sourceKeyword: string;

  @Column({ type: 'varchar', length: 255, name: 'title' })
  title: string;

  @Column({ type: 'varchar', length: 255, name: 'search_query' })
  searchQuery: string;

  @Column({ type: 'text', name: 'intent_summary', nullable: true })
  intentSummary: string | null;

  @Column({ type: 'jsonb', name: 'article_ids', nullable: true })
  articleIds: number[] | null;

  @Column({ type: 'timestamptz', name: 'generated_at' })
  generatedAt: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
