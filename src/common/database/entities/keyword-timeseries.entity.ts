import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { KeywordEntity } from './keyword.entity';

/**
 * 키워드 시계열 데이터 엔티티
 */
@Entity('keyword_timeseries')
@Index('idx_keyword_timeseries_bucket_score', ['bucketTime', 'scoreSum'])
@Index('idx_keyword_timeseries_keyword_bucket', ['keywordId', 'bucketTime'])
export class KeywordTimeseriesEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'keyword_id' })
  keywordId: number;

  @Column({ type: 'timestamptz', name: 'bucket_time' })
  bucketTime: Date;

  @Column({ type: 'integer', name: 'freq', default: 0 })
  freq: number;

  @Column({ type: 'double precision', name: 'score_sum', default: 0 })
  scoreSum: number;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => KeywordEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'keyword_id' })
  keyword: KeywordEntity;
}

