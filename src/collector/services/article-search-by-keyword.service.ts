import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import {
  ArticleKeywordRepository,
  type SearchArticlesByKeywordParams,
  type SearchArticlesByKeywordResult,
} from '../../common/database/article-keyword.repository';

const CACHE_KEY_PREFIX = 'articles:by-keyword:v1';
const CACHE_TTL_SECONDS = 180;

@Injectable()
export class ArticleSearchByKeywordService implements OnModuleDestroy {
  private readonly logger = new Logger(ArticleSearchByKeywordService.name);
  private readonly redis: Redis;

  constructor(
    private readonly configService: ConfigService,
    private readonly articleKeywordRepository: ArticleKeywordRepository,
  ) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
    });
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
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
      const fresh = await this.articleKeywordRepository.searchArticlesByKeyword(
        normalized,
      );
      await this.redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(fresh));
      return fresh;
    } catch (err) {
      this.logger.warn(
        '키워드 기사 검색 캐시 실패, DB 직접 조회',
        err instanceof Error ? err.message : String(err),
      );
      return this.articleKeywordRepository.searchArticlesByKeyword(normalized);
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
