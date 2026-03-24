import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { KeywordEntity } from './entities/keyword.entity';
import { ArticleKeywordEntity } from './entities/article-keyword.entity';
import { KeywordTimeseriesEntity } from './entities/keyword-timeseries.entity';
import { TopKeyword, RankedKeyword, RealtimeKeyword } from '../types/top-keyword.type';
import { TimeKeyword } from '../types/time-keyword.type';
import { SearchKeyword } from '../types/keyword.type';
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

  async findById(id: number): Promise<KeywordEntity | null> {
    return this.keywordRepository.findOne({ where: { id } });
  }

  async searchKeyword(keyword: string, limit: number): Promise<SearchKeyword[]> {
    const query = `
      SELECT
        id AS "keywordId",
        normalized_text AS "normalizedText"
      FROM keywords
      WHERE normalized_text ILIKE '%' || $1 || '%'
      ORDER BY
        CASE
          WHEN normalized_text ILIKE $1 || '%' THEN 0
          WHEN normalized_text ILIKE '%' || $1 || '%' THEN 1
          ELSE 2
        END,
        LENGTH(normalized_text) ASC
      LIMIT $2;

    `;
    const result = await this.dataSource.query(query, [keyword, limit]);
    return result.map((row) => ({
      id: row.keywordId,
      normalizedText: row.normalizedText,
    }));
  }

  async getTimeKeywordsByKeywordId(keywordId: number, limit: number): Promise<TimeKeyword[]> {
    const query = `
      SELECT
        bucket_time AS "bucketTime",
        freq AS "freqSum",
        score_sum AS "scoreSum"
      FROM keyword_timeseries
      WHERE keyword_id = $1
      AND bucket_time >= NOW() - INTERVAL '24 hour'
      ORDER BY bucket_time DESC
      LIMIT $2;
    `;

    const result = await this.dataSource.query(query, [keywordId, limit]);
    return result.map((row) => ({
      bucketTime: row.bucketTime,
      freqSum: row.freqSum,
      scoreSum: row.scoreSum,
    }));
  }

  async getTotalKeywords(): Promise<number> {
    const query = `
      SELECT COUNT(*) FROM keywords;
    `;
    const result = await this.dataSource.query(query);
    return result[0].count;
  }

  async getRanking(recentBuckets: number, limit: number): Promise<TopKeyword[]> {
    const query = `
      WITH recent_buckets AS (
        SELECT DISTINCT bucket_time
        FROM keyword_timeseries
        ORDER BY bucket_time DESC
        LIMIT $1
      )
      SELECT
        k.id AS "id",
        k.normalized_text AS "normalizedText",
        SUM(kt.freq)::bigint AS "freqSum",
        SUM(kt.score_sum)::float8 AS "scoreSum"
      FROM keyword_timeseries kt
      JOIN recent_buckets rb ON rb.bucket_time = kt.bucket_time
      JOIN keywords k ON k.id = kt.keyword_id
      WHERE k.type = 'SINGLE'
      GROUP BY k.id, k.normalized_text
      ORDER BY "scoreSum" DESC
      LIMIT $2;
    `;

    const result = await this.dataSource.query(query, [recentBuckets, limit]);
    return result.map((row) => ({
      id: row.id,
      normalizedText: row.normalizedText,
      freqSum: row.freqSum,
      scoreSum: row.scoreSum,
    }));
  }

  /**
   * 최근 24시간 기준 상위 키워드 (COMPOSITE). 토큰·버킷 유사도로 병합 후 대표만 반환.
   * 시간 창은 DB 세션 기준(운영 KST 가정).
   *
   * @param resultLimit - 최종 대표 개수
   * @param similarityPoolLimit - 유사도 계산에 넣을 상위 후보 수 (작을수록 빠름)
   */
  async findTopKeywords24h(
    resultLimit: number = 20,
    similarityPoolLimit: number = 500,
  ): Promise<RankedKeyword[]> {
    const query = `
  WITH scored_all AS (
    SELECT
      k.id,
      k.normalized_text,
      k.display_text,
      SPLIT_PART(k.normalized_text, ':', 1) AS t1,
      SPLIT_PART(k.normalized_text, ':', 2) AS t2,
      SUM(CASE WHEN kt.bucket_time >= NOW() - INTERVAL '24 hours' THEN kt.score_sum ELSE 0 END)::float8 AS score_24h,
      (
        SUM(CASE WHEN kt.bucket_time >= NOW() - INTERVAL '24 hours' THEN kt.score_sum ELSE 0 END) * 1.5
        + SUM(CASE WHEN kt.bucket_time >= NOW() - INTERVAL '2 hours' THEN kt.score_sum ELSE 0 END) * 0.2
      )::float8 AS final_score
    FROM keywords k
    JOIN keyword_timeseries kt ON k.id = kt.keyword_id
    WHERE k.type = 'COMPOSITE'
      AND kt.bucket_time >= NOW() - INTERVAL '24 hours'
    GROUP BY k.id, k.normalized_text, k.display_text
    HAVING SUM(kt.score_sum) > 0
  ),
  scored AS (
    SELECT * FROM scored_all
    ORDER BY final_score DESC
    LIMIT $1
  ),
  active_buckets AS (
    SELECT s.id, kt.bucket_time
    FROM scored s
    JOIN keywords k ON (k.normalized_text = s.t1 OR k.normalized_text = s.t2) AND k.type = 'SINGLE'
    JOIN keyword_timeseries kt ON kt.keyword_id = k.id
    WHERE kt.bucket_time >= NOW() - INTERVAL '24 hours'
      AND kt.score_sum > 0
    GROUP BY s.id, kt.bucket_time
  ),
  bucket_counts AS (
    SELECT id, COUNT(*)::int AS cnt FROM active_buckets GROUP BY id
  ),
  similarity AS (
    SELECT
      s1.id AS low_id,
      s2.id AS high_id,
      COUNT(DISTINCT b1.bucket_time) AS shared_cnt,
      bc1.cnt AS bc1_cnt,
      bc2.cnt AS bc2_cnt
    FROM scored s1
    JOIN scored s2
      ON s1.id != s2.id
      AND (s1.t1 IN (s2.t1, s2.t2) OR s1.t2 IN (s2.t1, s2.t2))
      AND s2.final_score > s1.final_score
    JOIN active_buckets b1 ON b1.id = s1.id
    JOIN active_buckets b2 ON b2.id = s2.id AND b1.bucket_time = b2.bucket_time
    JOIN bucket_counts bc1 ON bc1.id = s1.id
    JOIN bucket_counts bc2 ON bc2.id = s2.id
    GROUP BY s1.id, s2.id, bc1.cnt, bc2.cnt
    HAVING COUNT(DISTINCT b1.bucket_time)::float8
      / NULLIF(GREATEST(bc1.cnt + bc2.cnt - COUNT(DISTINCT b1.bucket_time), 1), 0) >= 0.35
  ),
  sub_map AS (
    SELECT DISTINCT ON (low_id)
      low_id AS sub_id,
      high_id AS main_id
    FROM similarity
    ORDER BY low_id, shared_cnt DESC
  ),
  group_stats AS (
    SELECT
      COALESCE(m.main_id, sa.id) AS rep_id,
      SUM(sa.final_score)::float8 AS total_group_score,
      SUM(sa.score_24h)::float8 AS total_group_score24h
    FROM scored_all sa
    LEFT JOIN sub_map m ON sa.id = m.sub_id
    GROUP BY 1
  )
  SELECT
    s.id AS "id",
    s.normalized_text AS "normalizedText",
    s.display_text AS "displayText",
    gs.total_group_score24h AS "score24h"
  FROM scored_all s
  JOIN group_stats gs ON s.id = gs.rep_id
  WHERE NOT EXISTS (SELECT 1 FROM sub_map sm WHERE sm.sub_id = s.id)
  ORDER BY gs.total_group_score DESC
  LIMIT $2;
    `;

    const result = await this.dataSource.query(query, [similarityPoolLimit, resultLimit]);
    return result.map((row) => ({
      id: Number(row.id),
      normalizedText: row.normalizedText,
      displayText: row.displayText ?? null,
      score24h: Number.parseFloat(row.score24h),
    }));
  }

  /**
   * 실시간 트렌드 키워드 조회 (최근 1시간 화력 중심)
   * @param limit - 조회할 키워드 개수 (기본값: 50)
   */
  async findTopKeywordsRealtime(limit: number = 50): Promise<RealtimeKeyword[]> {
    const query = `
    -- 최근 1시간: 현재의 실시간 화력
    WITH score_recent AS (
      SELECT
        kt.keyword_id,
        SUM(kt.score_sum)::float8 AS score_recent
      FROM keyword_timeseries kt
      WHERE kt.bucket_time >= NOW() - INTERVAL '1 hour'
      GROUP BY kt.keyword_id
    ),
    -- 직전 1시간 (1~2시간 전): 비교 대상 데이터
    score_prev AS (
      SELECT
        kt.keyword_id,
        SUM(kt.score_sum)::float8 AS score_prev
      FROM keyword_timeseries kt
      WHERE kt.bucket_time >= NOW() - INTERVAL '2 hours'
        AND kt.bucket_time < NOW() - INTERVAL '1 hour'
      GROUP BY kt.keyword_id
    ),
    -- 최근 24시간: 키워드의 기초 체력 (신뢰도 확인용)
    score_24h AS (
      SELECT
        kt.keyword_id,
        SUM(kt.score_sum)::float8 AS score_24h
      FROM keyword_timeseries kt
      WHERE kt.bucket_time >= NOW() - INTERVAL '24 hours'
      GROUP BY kt.keyword_id
    )
    SELECT
      k.id AS "id",
      k.normalized_text AS "normalizedText",
      k.display_text AS "displayText",
      k.type AS "type",
      k.created_at AS "createdAt",
      COALESCE(s24.score_24h, 0) AS "score24h",
      COALESCE(sr.score_recent, 0) AS "scoreRecent",
      COALESCE(sp.score_prev, 0) AS "scorePrev",
      (COALESCE(sr.score_recent, 0) - COALESCE(sp.score_prev, 0)) AS "diffScore",
      -- 실시간 랭킹용 가중치 점수 (소수점 8자리까지 확보하여 정밀도 향상)
      (
        COALESCE(sr.score_recent, 0) * 0.6               -- 현재 화력 비중 강화 (60%)
        + (COALESCE(sr.score_recent, 0) - COALESCE(sp.score_prev, 0)) * 0.3 -- 상승폭 비중 (30%)
        + LEAST((COALESCE(sr.score_recent, 0) / (COALESCE(sp.score_prev, 0) + 1)) * 50, 150) -- 급상승 가속도 점수
        + (COALESCE(s24.score_24h, 0) * 0.05)           -- 24시간 누적분은 최소 반영 (5%)
      ) AS "finalScore"
    FROM keywords k
    JOIN score_recent sr ON sr.keyword_id = k.id  -- 실시간이므로 현재 점수가 있는 키워드만 노출
    LEFT JOIN score_prev sp ON sp.keyword_id = k.id
    LEFT JOIN score_24h s24 ON s24.keyword_id = k.id
    WHERE k.type = 'COMPOSITE'
      AND sr.score_recent > 0  -- 최소 화력이 있는 것만 필터링
    ORDER BY
      "finalScore" DESC,           -- 1. 계산된 가중치 점수가 높은 순
      "scoreRecent" DESC,          -- 2. (동점 시) 현재 1시간 화력이 더 강한 순
      "diffScore" DESC,            -- 3. (동점 시) 상승 속도가 더 가파른 순
      k.created_at DESC            -- 4. (동점 시) 가장 최근에 생성된 키워드 우선 (신선도)
    LIMIT $1;
    `;
    const result = await this.dataSource.query(query, [limit]);
    return result.map((row) => ({
      id: Number(row.id),
      normalizedText: row.normalizedText,
      displayText: row.displayText ?? null,
      type: row.type as 'SINGLE' | 'COMPOSITE' | null,
      createdAt: row.createdAt ?? null,
      score24h: Number.parseFloat(row.score24h),
      scoreRecent: Number.parseFloat(row.scoreRecent),
      scorePrev: Number.parseFloat(row.scorePrev),
      diffScore: Number.parseFloat(row.diffScore),
      finalScore: Number.parseFloat(row.finalScore),
    }));
  }

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
      // type 배열 생성 (복합키는 'COMPOSITE', 단일 키워드는 'SINGLE')
      const types = uniqueNormalizedTexts.map((normalized) => 
        this.isCompositeKeyword(normalized) ? 'COMPOSITE' : 'SINGLE'
      );
      const keywordIdMap = await this.upsertKeywordsBulk(
        queryRunner,
        uniqueNormalizedTexts,
        uniqueDisplayTexts,
        types,
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
      const types = normalizedTexts.map((normalized) => 
        this.isCompositeKeyword(normalized) ? 'COMPOSITE' : 'SINGLE'
      );
      const keywordIdMap = await this.upsertKeywordsBulk(
        queryRunner,
        normalizedTexts,
        displayTexts,
        types,
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
   * @param types - 키워드 타입 배열 ('SINGLE' 또는 'COMPOSITE')
   * @returns 키워드 ID 맵 (normalizedText -> keywordId)
   */
  private async upsertKeywordsBulk(
    queryRunner: QueryRunner,
    normalizedTexts: string[],
    displayTexts: string[],
    types: string[],
  ): Promise<Map<string, number>> {
    const query = `
      INSERT INTO keywords (normalized_text, display_text, type)
      SELECT * FROM UNNEST($1::VARCHAR(255)[], $2::VARCHAR(255)[], $3::VARCHAR(30)[])
      AS t(normalized_text, display_text, type)
      ON CONFLICT (normalized_text)
      DO UPDATE SET 
        -- 수동으로 display_text를 수정해도 다음 upsert에서 덮어쓰지 않도록 유지
        -- (빈 문자열일 때만 EXCLUDED 값으로 보정)
        display_text = COALESCE(NULLIF(keywords.display_text, ''), EXCLUDED.display_text),
        -- type도 기존 값이 있을 때는 유지 (NULL일 때만 채우기)
        type = COALESCE(keywords.type, EXCLUDED.type)
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
   * 복합키의 경우 정렬 후 조인하여 canonical form 생성
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
    
    // 복합키 처리 (':'로 구분된 경우)
    if (normalized.includes(':')) {
      const parts = normalized.split(':').map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length >= 2) {
        // 정렬 후 조인하여 canonical form 생성
        const sorted = [...parts].sort();
        normalized = sorted.join(':');
      } else {
        // ':'만 있고 실제 파트가 없는 경우 빈 문자열 반환
        return '';
      }
    }
    
    if (normalized.length < 2 || normalized.length > 100) {
      return '';
    }
    return normalized;
  }
  
  /**
   * 키워드가 복합키인지 판단
   * @param keyword - 키워드
   * @returns 복합키 여부
   */
  private isCompositeKeyword(keyword: string): boolean {
    return keyword.includes(':') && keyword.split(':').length >= 2;
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

