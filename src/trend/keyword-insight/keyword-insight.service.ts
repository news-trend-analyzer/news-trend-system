import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { KeywordRepository } from '../../common/database/keyword.repository';
import { ArticleKeywordRepository } from '../../common/database/article-keyword.repository';
import { KeywordInsightRepository } from '../../common/database/keyword-insight.repository';
import { OpenAILlmService } from './llm/openai-llm.service';
import type { RankedKeyword } from '../../common/types/top-keyword.type';

const TOP_KEYWORDS_LIMIT = 20;
const ARTICLES_PER_KEYWORD = 5;
const MAX_CHARS_PER_ARTICLE = 1500;
const CRON_EXPRESSION = '0 */5 * * * *'; // 5분마다
const CACHE_KEY = 'trend:keyword-insight:top';
const CACHE_MAX_LIMIT = 50;

export type KeywordInsightItem = {
  readonly keywordId: number;
  readonly keyword: string;
  readonly summary: string | null;
  readonly articleIds: number[] | null;
  readonly analyzedAt: Date | null;
};

@Injectable()
export class KeywordInsightService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeywordInsightService.name);
  private readonly redis: Redis;
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly keywordRepository: KeywordRepository,
    private readonly articleKeywordRepository: ArticleKeywordRepository,
    private readonly keywordInsightRepository: KeywordInsightRepository,
    private readonly llmService: OpenAILlmService,
  ) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
    });
  }

  onModuleInit(): void {
    this.logger.log('KeywordInsightService Redis 연결됨');
    void this.runScheduledInsight().catch((err) =>
      this.logger.error(
        '키워드 인사이트 초기 실행 실패',
        err instanceof Error ? err.stack : String(err),
      ),
    );
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /**
   * 10분마다 상위 랭킹 키워드 중 오늘 analysis_date에 없는 것만 LLM 요약 수행
   */
  @Cron(CRON_EXPRESSION)
  async runScheduledInsight(): Promise<void> {
    await this.processNewKeywords();
  }

  /**
   * 상위 N개 키워드 중 오늘 analysis_date 인사이트가 없는 것만 분석 후 저장
   */
  async processNewKeywords(limit: number = TOP_KEYWORDS_LIMIT): Promise<number> {
    if (this.isRunning) {
      this.logger.log('이전 인사이트 작업 진행 중, 스킵');
      return 0;
    }
    this.isRunning = true;
    try {
      this.logger.log('키워드 인사이트 처리 시작');
      const topKeywords = await this.keywordRepository.findTopKeywords24h(limit);
      if (topKeywords.length === 0) {
        this.logger.log('상위 랭킹 키워드 없음, 스킵');
        return 0;
      }
      const keywordIds = topKeywords.map((k) => k.id);
      const analysisDate = this.getKstDateString();
      const existingTodayIds = await this.keywordInsightRepository.findExistingKeywordIdsByDate(
        keywordIds,
        analysisDate,
      );
      const toProcess = topKeywords.filter((k) => !existingTodayIds.has(k.id));
      if (toProcess.length === 0) {
        this.logger.log(`오늘(${analysisDate}) 분석 대상 없음 (상위 ${limit}개 모두 생성됨)`);
        return 0;
      }
      this.logger.log(`오늘(${analysisDate}) 인사이트 ${toProcess.length}건 처리 시작`);
      let processed = 0;
      for (const kw of toProcess) {
        try {
          await this.analyzeAndSaveOne(kw, analysisDate);
          processed += 1;
        } catch (err) {
          this.logger.warn(
            `키워드 ${kw.id}(${kw.normalizedText}) 인사이트 실패`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      this.logger.log(`키워드 인사이트 ${processed}건 완료`);
      if (processed > 0) {
        await this.invalidateCache();
      }
      return processed;
    } finally {
      this.isRunning = false;
    }
  }

  private async invalidateCache(): Promise<void> {
    await this.redis.del(CACHE_KEY);
    this.logger.debug('키워드 인사이트 캐시 무효화');
  }

  private getKstDateString(date: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    return `${year}-${month}-${day}`;
  }

  private async analyzeAndSaveOne(keyword: RankedKeyword, analysisDate: string): Promise<void> {
    const articles = await this.articleKeywordRepository.getTopArticleBodiesByKeyword({
      keywordId: keyword.id,
      hoursInterval: 24,
      limit: ARTICLES_PER_KEYWORD,
      maxCharsPerArticle: MAX_CHARS_PER_ARTICLE,
    });
    if (articles.length === 0) {
      await this.keywordInsightRepository.save({
        keywordId: keyword.id,
        analysisDate,
        summary: '[관련 기사 없음]',
        articleIds: [],
        analyzedAt: new Date(),
      });
      return;
    }
    const label = keyword.displayText?.trim() || keyword.normalizedText;
    const summary = await this.llmService.analyzeKeywordTrend({
      keyword: label,
      articleSummaries: articles,
    });
    const articleIds = articles.map((a) => a.id);
    await this.keywordInsightRepository.save({
      keywordId: keyword.id,
      analysisDate,
      summary,
      articleIds,
      analyzedAt: new Date(),
    });
  }

  /**
   * 상위 랭킹 키워드와 인사이트 조합하여 반환 (API용)
   * 새 요약이 저장될 때만 캐시 무효화
   */
  async getTopKeywordsWithInsights(limit: number = 20): Promise<KeywordInsightItem[]> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Array<KeywordInsightItem & { analyzedAt?: string }>;
      const items: KeywordInsightItem[] = parsed.map((item) => ({
        ...item,
        analyzedAt: item.analyzedAt ? new Date(item.analyzedAt as string) : null,
      }));
      return items.slice(0, Math.min(limit, items.length));
    }
    const items = await this.fetchTopKeywordsWithInsights(CACHE_MAX_LIMIT);
    if (items.length > 0) {
      await this.redis.set(CACHE_KEY, JSON.stringify(items));
    }
    return items.slice(0, Math.min(limit, items.length));
  }

  /**
   * 키워드 ID로 LLM 인사이트 단건 조회
   */
  async getInsightByKeywordId(keywordId: number): Promise<KeywordInsightItem | null> {
    const [keyword, insight] = await Promise.all([
      this.keywordRepository.findById(keywordId),
      this.keywordInsightRepository.findByKeywordId(keywordId),
    ]);
    if (!keyword) {
      return null;
    }
    const label = keyword.displayText?.trim() || keyword.normalizedText;
    return {
      keywordId: keyword.id,
      keyword: label,
      summary: insight?.summary ?? null,
      articleIds: insight?.articleIds ?? null,
      analyzedAt: insight?.analyzedAt ?? null,
    };
  }

  private async fetchTopKeywordsWithInsights(
    limit: number,
  ): Promise<KeywordInsightItem[]> {
    const topKeywords = await this.keywordRepository.findTopKeywords24h(limit);
    if (topKeywords.length === 0) {
      return [];
    }
    const keywordIds = topKeywords.map((k) => k.id);
    const insightMap = await this.keywordInsightRepository.findByKeywordIds(keywordIds);
    return topKeywords.map((kw) => {
      const insight = insightMap.get(kw.id);
      const label = kw.displayText?.trim() || kw.normalizedText;
      return {
        keywordId: kw.id,
        keyword: label,
        summary: insight?.summary ?? null,
        articleIds: insight?.articleIds ?? null,
        analyzedAt: insight?.analyzedAt ?? null,
      } as KeywordInsightItem;
    });
  }
}
