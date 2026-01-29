import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 기사 엔티티
 */
@Entity('articles')
@Index('idx_articles_published_at', ['publishedAt'])
@Index('idx_articles_publisher_published_at', ['publisher', 'publishedAt'])
export class ArticleEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 50, name: 'publisher' })
  publisher: string;

  @Column({ type: 'text', name: 'url', unique: true })
  url: string;

  @Column({ type: 'text', name: 'title' })
  title: string;

  @Column({ type: 'text', name: 'body_text' })
  bodyText: string;

  @Column({ type: 'timestamptz', name: 'published_at' })
  publishedAt: Date;

  @Column({ type: 'timestamptz', name: 'collected_at', default: () => 'NOW()' })
  collectedAt: Date;

  @Column({ type: 'text', name: 'checksum_hash', nullable: true })
  checksumHash: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}

