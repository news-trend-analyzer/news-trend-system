import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * 키워드 엔티티
 */
@Entity('keywords')
export class KeywordEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 255, name: 'normalized_text', unique: true })
  normalizedText: string;

  @Column({ type: 'varchar', length: 255, name: 'display_text' })
  displayText: string;

  @Column({ type: 'varchar', length: 30, name: 'type', nullable: true })
  type: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}

