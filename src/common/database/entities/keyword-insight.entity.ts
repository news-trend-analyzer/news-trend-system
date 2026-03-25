import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 키워드 LLM 요약 엔티티
 * 상위 랭킹 키워드에 대해 기사 본문 기반 "왜 뜨는지" 분석 결과 저장
 */
@Entity('keyword_insights')
export class KeywordInsightEntity {
  @PrimaryColumn({ type: 'bigint', name: 'keyword_id' })
  keywordId: number;

  @PrimaryColumn({ type: 'date', name: 'analysis_date' })
  analysisDate: string;

  @Column({ type: 'text', name: 'summary' })
  summary: string;

  @Column({ type: 'jsonb', name: 'article_ids', nullable: true })
  articleIds: number[] | null;

  @Column({ type: 'timestamptz', name: 'analyzed_at' })
  analyzedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
