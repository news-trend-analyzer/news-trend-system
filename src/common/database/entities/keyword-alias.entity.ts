import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { KeywordEntity } from './keyword.entity';

/**
 * 키워드 별칭 엔티티
 */
@Entity('keyword_alias')
@Index('idx_keyword_alias_keyword_id', ['keywordId'])
export class KeywordAliasEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 255, name: 'alias_text', unique: true })
  aliasText: string;

  @Column({ type: 'bigint', name: 'keyword_id' })
  keywordId: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => KeywordEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'keyword_id' })
  keyword: KeywordEntity;
}

