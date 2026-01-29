import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { KeywordEntity } from './entities/keyword.entity';
import { ArticleKeywordEntity } from './entities/article-keyword.entity';
import { KeywordTimeseriesEntity } from './entities/keyword-timeseries.entity';

/**
 * 키워드 저장소 서비스
 * Keywords, ArticleKeywords, KeywordTimeseries 테이블에 대한 저장 로직 제공
 */
@Injectable()
export class KeywordRepository {
  private readonly logger = new Logger(KeywordRepository.name);

  constructor(
    @InjectRepository(KeywordEntity)
    private readonly keywordRepository: Repository<KeywordEntity>,
    @InjectRepository(ArticleKeywordEntity)
    private readonly articleKeywordRepository: Repository<ArticleKeywordEntity>,
    @InjectRepository(KeywordTimeseriesEntity)
    private readonly keywordTimeseriesRepository: Repository<KeywordTimeseriesEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 여러 기사의 키워드들을 배치로 저장 (성능 최적화)
   * @param params - 배치 저장 파라미터
   */
  async saveKeywordsWithRelationsBatch(params: {
    articles: Array<{
      articleId: number;
      keywords: Array<{ keyword: string; score: number }>;
    }>;
    bucketTime: Date;
  }): Promise<void> {
    if (params.articles.length === 0) {
      return;
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // 모든 기사의 키워드를 수집
      const allValidKeywords: Array<{
        keyword: string;
        score: number;
        normalizedText: string;
        articleId: number;
      }> = [];
      params.articles.forEach((article) => {
        article.keywords.forEach((kw) => {
          const normalizedText = this.normalizeKeyword(kw.keyword);
          if (normalizedText.length > 0) {
            allValidKeywords.push({
              keyword: kw.keyword,
              score: kw.score,
              normalizedText,
              articleId: article.articleId,
            });
          }
        });
      });
      if (allValidKeywords.length === 0) {
        await queryRunner.commitTransaction();
        return;
      }
      // 고유한 키워드만 추출하여 upsert
      const uniqueNormalizedTexts = Array.from(
        new Set(allValidKeywords.map((kw) => kw.normalizedText)),
      );
      const uniqueDisplayTexts = uniqueNormalizedTexts.map((normalized) => {
        const found = allValidKeywords.find((kw) => kw.normalizedText === normalized);
        return found ? found.keyword : normalized;
      });
      const keywordIdMap = await this.upsertKeywordsBulk(
        queryRunner,
        uniqueNormalizedTexts,
        uniqueDisplayTexts,
      );
      // article_keywords 배치 저장
      await this.insertArticleKeywordsBatch(
        queryRunner,
        allValidKeywords,
        keywordIdMap,
      );
      // keyword_timeseries 배치 저장
      await this.upsertKeywordTimeseriesBatch(
        queryRunner,
        allValidKeywords,
        keywordIdMap,
        params.bucketTime,
      );
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `배치 키워드 저장 실패: ${params.articles.length}건`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 키워드들을 배치로 upsert하고, article_keywords와 keyword_timeseries를 저장
   * @deprecated 레거시 메서드입니다. 현재 미사용. 대신 saveKeywordsWithRelationsBatch()를 사용하세요.
   * @param params - 저장 파라미터
   * @returns 저장된 키워드 ID 맵 (normalizedText -> keywordId)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async saveKeywordsWithRelations(params: {
    articleId: number;
    keywords: Array<{ keyword: string; score: number }>;
    bucketTime: Date;
  }): Promise<Map<string, number>> {
    if (params.keywords.length === 0) {
      return new Map();
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const validKeywords = params.keywords
        .map((kw) => ({
          keyword: kw.keyword,
          score: kw.score,
          normalizedText: this.normalizeKeyword(kw.keyword),
        }))
        .filter((kw) => kw.normalizedText.length > 0);
      if (validKeywords.length === 0) {
        await queryRunner.commitTransaction();
        return new Map();
      }
      const normalizedTexts = validKeywords.map((kw) => kw.normalizedText);
      const displayTexts = validKeywords.map((kw) => kw.keyword);
      const keywordIdMap = await this.upsertKeywordsBulk(
        queryRunner,
        normalizedTexts,
        displayTexts,
      );
      await this.insertArticleKeywordsBulk(
        queryRunner,
        params.articleId,
        validKeywords,
        keywordIdMap,
      );
      await this.upsertKeywordTimeseriesBulk(
        queryRunner,
        validKeywords,
        keywordIdMap,
        params.bucketTime,
      );
      await queryRunner.commitTransaction();
      return keywordIdMap;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `키워드 저장 실패: articleId=${params.articleId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 키워드들을 배치로 upsert
   * @param queryRunner - 트랜잭션 QueryRunner
   * @param normalizedTexts - 정규화된 키워드 텍스트 배열
   * @param displayTexts - 표시용 키워드 텍스트 배열
   * @returns 키워드 ID 맵 (normalizedText -> keywordId)
   */
  private async upsertKeywordsBulk(
    queryRunner: QueryRunner,
    normalizedTexts: string[],
    displayTexts: string[],
  ): Promise<Map<string, number>> {
    const types = new Array(normalizedTexts.length).fill(null);
    const query = `
      INSERT INTO keywords (normalized_text, display_text, type)
      SELECT * FROM UNNEST($1::VARCHAR(255)[], $2::VARCHAR(255)[], $3::VARCHAR(30)[])
      AS t(normalized_text, display_text, type)
      ON CONFLICT (normalized_text)
      DO UPDATE SET display_text = EXCLUDED.display_text
      RETURNING id, normalized_text
    `;
    const result = await queryRunner.query(query, [
      normalizedTexts,
      displayTexts,
      types,
    ]);
    const keywordIdMap = new Map<string, number>();
    result.forEach((row: { id: number; normalized_text: string }) => {
      keywordIdMap.set(row.normalized_text, row.id);
    });
    return keywordIdMap;
  }

  /**
   * article_keywords에 배치로 insert (중복 시 무시)
   * @param queryRunner - 트랜잭션 QueryRunner
   * @param articleId - 기사 ID
   * @param keywords - 키워드 배열 (normalizedText 포함)
   * @param keywordIdMap - 키워드 ID 맵
   */
  private async insertArticleKeywordsBulk(
    queryRunner: QueryRunner,
    articleId: number,
    keywords: Array<{ keyword: string; score: number; normalizedText: string }>,
    keywordIdMap: Map<string, number>,
  ): Promise<void> {
    const keywordIds: number[] = [];
    const weights: number[] = [];
    keywords.forEach((kw) => {
      const normalizedText = this.normalizeKeyword(kw.keyword);
      const keywordId = keywordIdMap.get(normalizedText);
      if (keywordId) {
        keywordIds.push(keywordId);
        weights.push(kw.score);
      }
    });
    if (keywordIds.length === 0) {
      return;
    }
    const articleIds = new Array(keywordIds.length).fill(articleId);
    const extractedAts = new Array(keywordIds.length).fill(new Date());
    const query = `
      INSERT INTO article_keywords (article_id, keyword_id, weight, extracted_at)
      SELECT * FROM UNNEST(
        $1::BIGINT[],
        $2::BIGINT[],
        $3::DOUBLE PRECISION[],
        $4::TIMESTAMPTZ[]
      ) AS t(article_id, keyword_id, weight, extracted_at)
      ON CONFLICT (article_id, keyword_id) DO NOTHING
    `;
    await queryRunner.query(query, [articleIds, keywordIds, weights, extractedAts]);
  }

  /**
   * 여러 기사의 article_keywords를 배치로 insert
   * @param queryRunner - 트랜잭션 QueryRunner
   * @param allKeywords - 모든 기사의 키워드 배열 (articleId 포함)
   * @param keywordIdMap - 키워드 ID 맵
   */
  private async insertArticleKeywordsBatch(
    queryRunner: QueryRunner,
    allKeywords: Array<{
      keyword: string;
      score: number;
      normalizedText: string;
      articleId: number;
    }>,
    keywordIdMap: Map<string, number>,
  ): Promise<void> {
    const articleIds: number[] = [];
    const keywordIds: number[] = [];
    const weights: number[] = [];
    allKeywords.forEach((kw) => {
      const keywordId = keywordIdMap.get(kw.normalizedText);
      if (keywordId) {
        articleIds.push(kw.articleId);
        keywordIds.push(keywordId);
        weights.push(kw.score);
      }
    });
    if (articleIds.length === 0) {
      return;
    }
    const extractedAts = new Array(articleIds.length).fill(new Date());
    const query = `
      INSERT INTO article_keywords (article_id, keyword_id, weight, extracted_at)
      SELECT * FROM UNNEST(
        $1::BIGINT[],
        $2::BIGINT[],
        $3::DOUBLE PRECISION[],
        $4::TIMESTAMPTZ[]
      ) AS t(article_id, keyword_id, weight, extracted_at)
      ON CONFLICT (article_id, keyword_id) DO NOTHING
    `;
    await queryRunner.query(query, [articleIds, keywordIds, weights, extractedAts]);
  }

  /**
   * keyword_timeseries를 배치로 upsert하여 freq와 score_sum 누적
   * @param queryRunner - 트랜잭션 QueryRunner
   * @param keywords - 키워드 배열 (normalizedText 포함)
   * @param keywordIdMap - 키워드 ID 맵
   * @param bucketTime - 버킷 시간 (5분 단위)
   */
  private async upsertKeywordTimeseriesBulk(
    queryRunner: QueryRunner,
    keywords: Array<{ keyword: string; score: number; normalizedText: string }>,
    keywordIdMap: Map<string, number>,
    bucketTime: Date,
  ): Promise<void> {
    // (keyword_id, bucket_time) 조합별로 집계하여 중복 제거
    const timeseriesMap = new Map<string, { freq: number; scoreSum: number }>();
    keywords.forEach((kw) => {
      const normalizedText = this.normalizeKeyword(kw.keyword);
      const keywordId = keywordIdMap.get(normalizedText);
      if (keywordId) {
        const key = `${keywordId}:${bucketTime.getTime()}`;
        const existing = timeseriesMap.get(key);
        if (existing) {
          existing.freq += 1;
          existing.scoreSum += kw.score;
        } else {
          timeseriesMap.set(key, {
            freq: 1,
            scoreSum: kw.score,
          });
        }
      }
    });
    if (timeseriesMap.size === 0) {
      return;
    }
    const keywordIds: number[] = [];
    const bucketTimes: Date[] = [];
    const freqs: number[] = [];
    const scoreSums: number[] = [];
    const updatedAts: Date[] = [];
    timeseriesMap.forEach((value, key) => {
      const [keywordIdStr] = key.split(':');
      keywordIds.push(Number.parseInt(keywordIdStr, 10));
      bucketTimes.push(bucketTime);
      freqs.push(value.freq);
      scoreSums.push(value.scoreSum);
      updatedAts.push(new Date());
    });
    const query = `
      INSERT INTO keyword_timeseries (keyword_id, bucket_time, freq, score_sum, updated_at)
      SELECT * FROM UNNEST(
        $1::BIGINT[],
        $2::TIMESTAMPTZ[],
        $3::INTEGER[],
        $4::DOUBLE PRECISION[],
        $5::TIMESTAMPTZ[]
      ) AS t(keyword_id, bucket_time, freq, score_sum, updated_at)
      ON CONFLICT (keyword_id, bucket_time)
      DO UPDATE SET
        freq = keyword_timeseries.freq + EXCLUDED.freq,
        score_sum = keyword_timeseries.score_sum + EXCLUDED.score_sum,
        updated_at = NOW()
    `;
    await queryRunner.query(query, [keywordIds, bucketTimes, freqs, scoreSums, updatedAts]);
  }

  /**
   * 여러 기사의 keyword_timeseries를 배치로 upsert
   * @param queryRunner - 트랜잭션 QueryRunner
   * @param allKeywords - 모든 기사의 키워드 배열
   * @param keywordIdMap - 키워드 ID 맵
   * @param bucketTime - 버킷 시간 (5분 단위)
   */
  private async upsertKeywordTimeseriesBatch(
    queryRunner: QueryRunner,
    allKeywords: Array<{
      keyword: string;
      score: number;
      normalizedText: string;
      articleId: number;
    }>,
    keywordIdMap: Map<string, number>,
    bucketTime: Date,
  ): Promise<void> {
    // (keyword_id, bucket_time) 조합별로 집계하여 중복 제거
    const timeseriesMap = new Map<string, { freq: number; scoreSum: number }>();
    allKeywords.forEach((kw) => {
      const keywordId = keywordIdMap.get(kw.normalizedText);
      if (keywordId) {
        const key = `${keywordId}:${bucketTime.getTime()}`;
        const existing = timeseriesMap.get(key);
        if (existing) {
          existing.freq += 1;
          existing.scoreSum += kw.score;
        } else {
          timeseriesMap.set(key, {
            freq: 1,
            scoreSum: kw.score,
          });
        }
      }
    });
    if (timeseriesMap.size === 0) {
      return;
    }
    const keywordIds: number[] = [];
    const bucketTimes: Date[] = [];
    const freqs: number[] = [];
    const scoreSums: number[] = [];
    const updatedAts: Date[] = [];
    timeseriesMap.forEach((value, key) => {
      const [keywordIdStr] = key.split(':');
      keywordIds.push(Number.parseInt(keywordIdStr, 10));
      bucketTimes.push(bucketTime);
      freqs.push(value.freq);
      scoreSums.push(value.scoreSum);
      updatedAts.push(new Date());
    });
    const query = `
      INSERT INTO keyword_timeseries (keyword_id, bucket_time, freq, score_sum, updated_at)
      SELECT * FROM UNNEST(
        $1::BIGINT[],
        $2::TIMESTAMPTZ[],
        $3::INTEGER[],
        $4::DOUBLE PRECISION[],
        $5::TIMESTAMPTZ[]
      ) AS t(keyword_id, bucket_time, freq, score_sum, updated_at)
      ON CONFLICT (keyword_id, bucket_time)
      DO UPDATE SET
        freq = keyword_timeseries.freq + EXCLUDED.freq,
        score_sum = keyword_timeseries.score_sum + EXCLUDED.score_sum,
        updated_at = NOW()
    `;
    await queryRunner.query(query, [keywordIds, bucketTimes, freqs, scoreSums, updatedAts]);
  }

  /**
   * 키워드 정규화 (노이즈 제거 및 정규화)
   * @param keyword - 원본 키워드
   * @returns 정규화된 키워드
   */
  private normalizeKeyword(keyword: string): string {
    let normalized = keyword.trim();
    normalized = normalized.replace(/\s+/g, ' ');
    normalized = normalized.replace(/[()「」『』《》〈〉【】〔〕""'']/g, '');
    normalized = normalized.replace(/\./g, '');
    normalized = normalized.toLowerCase();
    normalized = normalized.replace(/^(주식회사|\(주\)|주\)|기자|사진|제공|속보)\s*/i, '');
    normalized = normalized.replace(/\s*(기자|사진|제공|속보)$/i, '');
    normalized = normalized.trim();
    if (normalized.length < 2 || normalized.length > 40) {
      return '';
    }
    return normalized;
  }

  /**
   * 5분 단위로 버킷 시간 계산
   * @param date - 기준 시간
   * @param bucketMinutes - 버킷 단위 (분), 기본값 5분
   * @returns 버킷 시간
   */
  static calculateBucketTime(date: Date, bucketMinutes: number = 5): Date {
    const timestamp = date.getTime();
    const bucketMs = bucketMinutes * 60 * 1000;
    const bucketTimestamp = Math.floor(timestamp / bucketMs) * bucketMs;
    return new Date(bucketTimestamp);
  }
}

