import {
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
/** DB→Redis 갱신 주기(초). @Cron 과 TTL과 함께 유지 */
const ARTICLES_BY_KEYWORD_REFRESH_SECONDS = 30;
const ARTICLES_BY_KEYWORD_CRON =
  `*/${ARTICLES_BY_KEYWORD_REFRESH_SECONDS} * * * * *` as const;
const CACHE_TTL_SECONDS = ARTICLES_BY_KEYWORD_REFRESH_SECONDS * 3;
const PREWARM_KEYWORD_LIMIT = 20;
const PREWARM_DEFAULT_PARAMS = {
  page: 1,
  size: 20,
  hoursInterval: 24,
} as const;

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
    void this.prewarmTopKeywordArticleCaches().catch((err) =>
      this.logger.error(
        '초기 키워드 기사 캐시 프리워밍 실패',
        err instanceof Error ? err.stack : String(err),
      ),
    );
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
      this.logger.warn(
        '키워드 기사 캐시 프리워밍 실패',
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  async searchArticlesByKeyword(
    params: SearchArticlesByKeywordParams,
  ): Promise<SearchArticlesByKeywordResult> {
    const normalized = this.normalizeParams(params);
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
    const [realtime, top24h] = await Promise.all([
      this.keywordRepository.findTopKeywordsRealtime(PREWARM_KEYWORD_LIMIT),
      this.keywordRepository.findTopKeywords24h(PREWARM_KEYWORD_LIMIT),
    ]);
    const keysWarmed = new Set<string>();
    const prewarmLabel = async (label: string): Promise<void> => {
      const normalized = this.normalizeParams({
        keyword: label,
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
          `키워드 기사 캐시 프리워밍 실패: ${label}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    };
    for (const kw of realtime) {
      await prewarmLabel(kw.displayText?.trim() || kw.normalizedText);
    }
    for (const kw of top24h) {
      await prewarmLabel(kw.displayText?.trim() || kw.normalizedText);
    }
  }

  private normalizeParams(
    params: SearchArticlesByKeywordParams,
  ): SearchArticlesByKeywordParams {
    const hoursInterval = params.hoursInterval ?? 24;
    const size = Math.min(Math.max(params.size ?? 20, 1), 50);
    const page = Math.max(params.page ?? 1, 1);
    return {
      keyword: params.keyword.trim(),
      hoursInterval,
      size,
      page,
    };
  }

  private buildCacheKey(params: SearchArticlesByKeywordParams): string {
    const hash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify([
          params.keyword,
          params.page,
          params.size,
          params.hoursInterval,
        ]),
      )
      .digest('hex')
      .slice(0, 32);
    return `${CACHE_KEY_PREFIX}:${hash}`;
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
