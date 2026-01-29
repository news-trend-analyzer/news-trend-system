import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ArticleEntity } from './entities/article.entity';

/**
 * 기사 저장소 서비스
 * Articles 테이블에 대한 upsert 로직 제공
 */
@Injectable()
export class ArticleRepository {
  private readonly logger = new Logger(ArticleRepository.name);

  constructor(
    @InjectRepository(ArticleEntity)
    private readonly articleRepository: Repository<ArticleEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 기사를 URL 기준으로 upsert
   * @deprecated 레거시 메서드입니다. 현재 미사용. 대신 upsertArticlesBulk()를 사용하세요.
   * @param article - 저장할 기사 데이터
   * @returns 저장된 기사 엔티티
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async upsertArticle(article: {
    publisher: string;
    url: string;
    title: string;
    bodyText: string;
    publishedAt: Date;
    collectedAt: Date;
    checksumHash?: string | null;
  }): Promise<ArticleEntity> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(ArticleEntity)
        .values({
          publisher: article.publisher,
          url: article.url,
          title: article.title,
          bodyText: article.bodyText,
          publishedAt: article.publishedAt,
          collectedAt: article.collectedAt,
          checksumHash: article.checksumHash || null,
        })
        .orUpdate(
          ['publisher', 'title', 'bodyText', 'publishedAt', 'collectedAt', 'checksumHash'],
          ['url'],
        )
        .returning('*')
        .execute();
      await queryRunner.commitTransaction();
      return result.raw[0] as ArticleEntity;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `기사 upsert 실패: ${article.url}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 기사들을 배치로 upsert (성능 최적화)
   * PostgreSQL의 unnest를 사용하여 효율적인 배치 처리
   * @param articles - 저장할 기사 데이터 배열
   * @returns 저장된 기사 엔티티 배열
   */
  async upsertArticlesBulk(articles: Array<{
    publisher: string;
    url: string;
    title: string;
    bodyText: string;
    publishedAt: Date;
    collectedAt: Date;
    checksumHash?: string | null;
  }>): Promise<ArticleEntity[]> {
    if (articles.length === 0) {
      return [];
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const publishers = articles.map((a) => a.publisher);
      const urls = articles.map((a) => a.url);
      const titles = articles.map((a) => a.title);
      const bodyTexts = articles.map((a) => a.bodyText);
      const publishedAts = articles.map((a) => a.publishedAt);
      const collectedAts = articles.map((a) => a.collectedAt);
      const checksumHashes = articles.map((a) => a.checksumHash || null);
      const query = `
        INSERT INTO articles (publisher, url, title, body_text, published_at, collected_at, checksum_hash)
        SELECT * FROM UNNEST(
          $1::VARCHAR(50)[],
          $2::TEXT[],
          $3::TEXT[],
          $4::TEXT[],
          $5::TIMESTAMPTZ[],
          $6::TIMESTAMPTZ[],
          $7::TEXT[]
        ) AS t(publisher, url, title, body_text, published_at, collected_at, checksum_hash)
        ON CONFLICT (url)
        DO UPDATE SET
          publisher = EXCLUDED.publisher,
          title = EXCLUDED.title,
          body_text = EXCLUDED.body_text,
          published_at = EXCLUDED.published_at,
          collected_at = EXCLUDED.collected_at,
          checksum_hash = EXCLUDED.checksum_hash
        RETURNING *
      `;
      const result = await queryRunner.query(query, [
        publishers,
        urls,
        titles,
        bodyTexts,
        publishedAts,
        collectedAts,
        checksumHashes,
      ]);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `기사 배치 upsert 실패: ${articles.length}건`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * URL로 기사 조회
   * @param url - 조회할 기사 URL
   * @returns 기사 엔티티 또는 null
   */
  async findByUrl(url: string): Promise<ArticleEntity | null> {
    return this.articleRepository.findOne({ where: { url } });
  }
}

