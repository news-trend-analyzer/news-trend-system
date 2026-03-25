import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { KeywordRepository } from '../../common/database/keyword.repository';
import {
  ArticleKeywordRepository,
  type SearchArticlesByKeywordParams,
  type SearchArticlesByKeywordResult,
} from '../../common/database/article-keyword.repository';

const CACHE_KEY_PREFIX = 'articles:by-keyword:v1';
/** 상위 키워드 Redis 프리워밍 주기(초). @Cron 표현식과 맞출 것 */
const ARTICLES_BY_KEYWORD_REFRESH_SECONDS = 30;
const ARTICLES_BY_KEYWORD_CRON =
  `*/${ARTICLES_BY_KEYWORD_REFRESH_SECONDS} * * * * *` as const;
/** Redis 키 만료(초). 프리워밍이 없는 조합은 이 시간 동안 히트 */
const CACHE_TTL_SECONDS = 300;
/** 트렌드 /trend/realtime 기본 limit(20)과 맞춤 */
const PREWARM_KEYWORD_LIMIT = 20;
/** 동시 DB 조회 수 (연속 await 제거로 기동·크론 주기 내 프리워밍 완료 시간 단축) */
const PREWARM_CONCURRENCY = 8;
const PREWARM_DEFAULT_PARAMS = {
  page: 1,
  size: 20,
  hoursInterval: 24,
} as const;

/** 컨트롤러·DTO에서 들어오는 원시 쿼리 */
type ArticleSearchByKeywordQuery = {
  readonly keyword?: string;
  readonly keywordId?: number;
  readonly hoursInterval?: number;
  readonly page?: number;
  readonly size?: number;
};

@Injectable()
export class ArticleSearchByKeywordService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ArticleSearchByKeywordService.name);
  private readonly redis: Redis;
  private readonly refreshInFlight = new Map<
    string,
    Promise<SearchArticlesByKeywordResult>
  >();
  private prewarmAllInFlight: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly articleKeywordRepository: ArticleKeywordRepository,
    private readonly keywordRepository: KeywordRepository,
  ) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
    });
  }

  onModuleInit(): void {
    this.handleArticlesByKeywordCacheRefreshCron();
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /**
   * 실시간·24h 상위 키워드 기준 주기적 캐시 갱신 (GET 은 캐시 우선)
   */
  @Cron(ARTICLES_BY_KEYWORD_CRON)
  handleArticlesByKeywordCacheRefreshCron(): void {
    void this.prewarmTopKeywordArticleCaches().catch((err) =>
      this.logger.error(
        '키워드 기사 캐시 프리워밍 실패',
        err instanceof Error ? err.stack : String(err),
      ),
    );
  }

  async searchArticlesByKeyword(
    query: ArticleSearchByKeywordQuery,
  ): Promise<SearchArticlesByKeywordResult> {
    const normalized = this.normalizeParams(query);
    const key = this.buildCacheKey(normalized);
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return this.deserializeResult(cached);
      }
      return await this.runArticlesByKeywordRefresh(key, normalized);
    } catch (err) {
      this.logger.warn(
        '키워드 기사 검색 Redis 실패, DB 직접 조회',
        err instanceof Error ? err.message : String(err),
      );
      return this.articleKeywordRepository.searchArticlesByKeyword(normalized);
    }
  }

  private async runArticlesByKeywordRefresh(
    key: string,
    normalized: SearchArticlesByKeywordParams,
  ): Promise<SearchArticlesByKeywordResult> {
    const inflight = this.refreshInFlight.get(key);
    if (inflight) {
      return inflight;
    }
    const promise = this.doComputeAndStoreArticlesByKeyword(key, normalized).finally(
      () => {
        this.refreshInFlight.delete(key);
      },
    );
    this.refreshInFlight.set(key, promise);
    return promise;
  }

  private async doComputeAndStoreArticlesByKeyword(
    key: string,
    normalized: SearchArticlesByKeywordParams,
  ): Promise<SearchArticlesByKeywordResult> {
    const fresh =
      await this.articleKeywordRepository.searchArticlesByKeyword(normalized);
    await this.redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(fresh));
    return fresh;
  }

  private async prewarmTopKeywordArticleCaches(): Promise<void> {
    if (this.prewarmAllInFlight) {
      return this.prewarmAllInFlight;
    }
    this.prewarmAllInFlight = this.runPrewarmTopKeywordArticleCaches().finally(() => {
      this.prewarmAllInFlight = null;
    });
    return this.prewarmAllInFlight;
  }

  private async runPrewarmTopKeywordArticleCaches(): Promise<void> {
    const [realtime, top24h] = await Promise.all([
      this.keywordRepository.findTopKeywordsRealtime(PREWARM_KEYWORD_LIMIT),
      this.keywordRepository.findTopKeywords24h(PREWARM_KEYWORD_LIMIT),
    ]);
    const orderedIds: number[] = [];
    const seenId = new Set<number>();
    const pushId = (id: number): void => {
      if (!seenId.has(id)) {
        seenId.add(id);
        orderedIds.push(id);
      }
    };
    for (const kw of realtime) {
      pushId(Number(kw.id));
    }
    for (const kw of top24h) {
      pushId(Number(kw.id));
    }
    const keysWarmed = new Set<string>();
    const prewarmOne = async (keywordId: number): Promise<void> => {
      const normalized = this.normalizeParams({
        keywordId,
        page: PREWARM_DEFAULT_PARAMS.page,
        size: PREWARM_DEFAULT_PARAMS.size,
        hoursInterval: PREWARM_DEFAULT_PARAMS.hoursInterval,
      });
      const key = this.buildCacheKey(normalized);
      if (keysWarmed.has(key)) {
        return;
      }
      keysWarmed.add(key);
      try {
        await this.doComputeAndStoreArticlesByKeyword(key, normalized);
      } catch (err) {
        this.logger.warn(
          `키워드 기사 캐시 프리워밍 실패 keywordId=${keywordId}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    };
    for (let i = 0; i < orderedIds.length; i += PREWARM_CONCURRENCY) {
      const chunk = orderedIds.slice(i, i + PREWARM_CONCURRENCY);
      await Promise.all(chunk.map((id) => prewarmOne(id)));
    }
  }

  private normalizeParams(query: ArticleSearchByKeywordQuery): SearchArticlesByKeywordParams {
    const hoursInterval = query.hoursInterval ?? 24;
    const size = Math.min(Math.max(query.size ?? 20, 1), 50);
    const page = Math.max(query.page ?? 1, 1);
    const rawId = query.keywordId;
    if (rawId != null && Number.isFinite(rawId)) {
      const keywordId = Math.floor(Number(rawId));
      if (keywordId >= 1) {
        return { keywordId, hoursInterval, size, page };
      }
    }
    const kw = query.keyword?.trim() ?? '';
    if (kw.length > 0) {
      return { keyword: kw, hoursInterval, size, page };
    }
    throw new BadRequestException('keyword 또는 keywordId 중 하나는 필요합니다.');
  }

  private buildCacheKey(params: SearchArticlesByKeywordParams): string {
    const parts: unknown[] =
      'keywordId' in params
        ? ['id', params.keywordId, params.page, params.size, params.hoursInterval]
        : [
            'text',
            this.resolveKeywordForCacheKey(params.keyword),
            params.page,
            params.size,
            params.hoursInterval,
          ];
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(parts))
      .digest('hex')
      .slice(0, 32);
    return `${CACHE_KEY_PREFIX}:${hash}`;
  }

  /**
   * 텍스트 검색 전용: 표시/정규화 문자열이 달라도 동일 캐시(복합 키는 원문 유지)
   */
  private resolveKeywordForCacheKey(keyword: string): string {
    if (this.isCompositeKeywordInput(keyword)) {
      return keyword;
    }
    const canonical = this.keywordRepository.normalizeKeywordForCache(keyword);
    return canonical.length > 0 ? canonical : keyword;
  }

  private isCompositeKeywordInput(keyword: string): boolean {
    const parts = keyword
      .split(':')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    return parts.length >= 2;
  }

  private deserializeResult(cached: string): SearchArticlesByKeywordResult {
    const parsed = JSON.parse(cached) as SearchArticlesByKeywordResult;
    return {
      ...parsed,
      items: parsed.items.map((item) => ({
        ...item,
        publishedAt: new Date(item.publishedAt),
      })),
    };
  }
}
