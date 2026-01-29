import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ArticleEntity } from './article.entity';
import { KeywordEntity } from './keyword.entity';

/**
 * 기사-키워드 매핑 엔티티
 */
@Entity('article_keywords')
@Index('idx_article_keywords_keyword_article', ['keywordId', 'articleId'])
@Index('idx_article_keywords_article_id', ['articleId'])
export class ArticleKeywordEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'article_id' })
  articleId: number;

  @Column({ type: 'bigint', name: 'keyword_id' })
  keywordId: number;

  @Column({ type: 'double precision', name: 'weight', default: 1.0 })
  weight: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'extracted_at' })
  extractedAt: Date;

  @ManyToOne(() => ArticleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'article_id' })
  article: ArticleEntity;

  @ManyToOne(() => KeywordEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'keyword_id' })
  keyword: KeywordEntity;
}

