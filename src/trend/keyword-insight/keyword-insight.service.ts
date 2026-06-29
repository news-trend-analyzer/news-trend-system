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
import type {
  KeywordBriefing,
  KeywordBriefingTrendSignal,
  LlmKeywordBriefing,
} from './types/keyword-briefing.type';

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
  readonly articleCount: number;
  readonly briefing: KeywordBriefing | null;
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
        briefing: this.buildFallbackBriefing({
          keyword: keyword.displayText?.trim() || keyword.normalizedText,
          summary: '[관련 기사 없음]',
          articleIds: [],
          articleCount: 0,
          trendSignal: this.buildTrendSignal([]),
        }),
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
    const [articleCount, timeSeries, llmBriefing] = await Promise.all([
      this.articleKeywordRepository.countArticlesByKeyword(keyword.id, 24),
      this.keywordRepository.getTimeKeywordsByKeywordId(keyword.id, 24),
      this.llmService.generateKeywordBriefing({
        keyword: label,
        summary,
        articleSummaries: articles,
      }),
    ]);
    const briefing = this.buildBriefing({
      keyword: label,
      summary,
      articleIds,
      articleCount,
      trendSignal: this.buildTrendSignal(timeSeries),
      llmBriefing,
    });
    await this.keywordInsightRepository.save({
      keywordId: Number(keyword.id),
      analysisDate,
      summary,
      articleIds,
      briefing: briefing as unknown as Record<string, unknown>,
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
    const [articleCount, timeSeries] = await Promise.all([
      this.articleKeywordRepository.countArticlesByKeyword(keywordId, 24),
      this.keywordRepository.getTimeKeywordsByKeywordId(keywordId, 24),
    ]);
    const trendSignal = this.buildTrendSignal(timeSeries);
    const articleIds = insight?.articleIds ?? [];
    let storedBriefing = insight?.briefing;
    if (insight && !storedBriefing && insight.summary && articleCount > 0) {
      storedBriefing = await this.generateAndPersistBriefingForExistingInsight({
        keywordId,
        analysisDate: insight.analysisDate,
        keyword: label,
        summary: insight.summary,
        articleIds,
        articleCount,
        trendSignal,
        analyzedAt: insight.analyzedAt,
      });
    }
    const briefing = this.normalizeStoredBriefing({
      keyword: label,
      summary: insight?.summary ?? null,
      articleIds,
      articleCount,
      trendSignal,
      briefing: storedBriefing,
    });
    return {
      keywordId: Number(keyword.id),
      keyword: label,
      summary: insight?.summary ?? null,
      articleIds: insight?.articleIds ?? null,
      analyzedAt: insight?.analyzedAt ?? null,
      articleCount,
      briefing,
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
        articleCount: 0,
        briefing: null,
      } as KeywordInsightItem;
    });
  }

  private buildBriefing(params: {
    keyword: string;
    summary: string | null;
    articleIds: number[];
    articleCount: number;
    trendSignal: KeywordBriefingTrendSignal;
    llmBriefing: LlmKeywordBriefing;
  }): KeywordBriefing {
    const interestBase = Math.max(params.articleCount, params.articleIds.length, 1);
    return {
      oneLineSummary: params.llmBriefing.oneLineSummary,
      whySteps: params.llmBriefing.whySteps,
      trendSignal: params.trendSignal,
      questions: params.llmBriefing.questions.map((q, index) => ({
        question: q.question,
        answer: q.answer,
        interestCount: interestBase * 100 + (params.llmBriefing.questions.length - index) * 17,
      })),
      essentialArticleIds: params.articleIds.slice(0, 5),
    };
  }

  private async generateAndPersistBriefingForExistingInsight(params: {
    keywordId: number;
    analysisDate: string;
    keyword: string;
    summary: string;
    articleIds: number[];
    articleCount: number;
    trendSignal: KeywordBriefingTrendSignal;
    analyzedAt: Date;
  }): Promise<Record<string, unknown> | null> {
    try {
      const articles = await this.articleKeywordRepository.getTopArticleBodiesByKeyword({
        keywordId: params.keywordId,
        hoursInterval: 24,
        limit: ARTICLES_PER_KEYWORD,
        maxCharsPerArticle: MAX_CHARS_PER_ARTICLE,
      });
      if (articles.length === 0) {
        return null;
      }
      const llmBriefing = await this.llmService.generateKeywordBriefing({
        keyword: params.keyword,
        summary: params.summary,
        articleSummaries: articles,
      });
      const briefing = this.buildBriefing({
        keyword: params.keyword,
        summary: params.summary,
        articleIds:
          params.articleIds.length > 0
            ? params.articleIds
            : articles.map((article) => article.id),
        articleCount: params.articleCount,
        trendSignal: params.trendSignal,
        llmBriefing,
      });
      await this.keywordInsightRepository.save({
        keywordId: params.keywordId,
        analysisDate: params.analysisDate,
        summary: params.summary,
        articleIds:
          params.articleIds.length > 0
            ? params.articleIds
            : articles.map((article) => article.id),
        briefing: briefing as unknown as Record<string, unknown>,
        analyzedAt: params.analyzedAt,
      });
      return briefing as unknown as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(
        `키워드 ${params.keywordId} 브리핑 온디맨드 생성 실패`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  private buildFallbackBriefing(params: {
    keyword: string;
    summary: string | null;
    articleIds: number[];
    articleCount: number;
    trendSignal: KeywordBriefingTrendSignal;
  }): KeywordBriefing {
    const label = params.keyword.replace(/:/g, ' ');
    const oneLineSummary =
      params.summary && !params.summary.startsWith('[관련 기사 없음]')
        ? params.summary
        : `${label} 관련 기사와 언급량이 함께 늘며 검색 관심이 커지고 있습니다.`;
    return {
      oneLineSummary,
      whySteps: [
        '관련 이슈 발생',
        '보도 확산',
        '검색 관심 증가',
      ],
      trendSignal: params.trendSignal,
      questions: [
        {
          question: '왜 지금 관심이 커졌나요?',
          answer:
            '관련 기사와 키워드 언급이 같은 시간대에 집중되며 트렌드 랭킹에 반영됐습니다. 상위 기사와 함께 보면 관심이 커진 계기를 더 구체적으로 확인할 수 있습니다.',
          interestCount: Math.max(params.articleCount, 1) * 100,
        },
      ],
      essentialArticleIds: params.articleIds.slice(0, 5),
    };
  }

  private normalizeStoredBriefing(params: {
    keyword: string;
    summary: string | null;
    articleIds: number[];
    articleCount: number;
    trendSignal: KeywordBriefingTrendSignal;
    briefing: Record<string, unknown> | null | undefined;
  }): KeywordBriefing {
    const fallback = this.buildFallbackBriefing(params);
    const briefing = params.briefing as Partial<KeywordBriefing> | null | undefined;
    if (!briefing) {
      return fallback;
    }
    return {
      oneLineSummary:
        typeof briefing.oneLineSummary === 'string'
          ? briefing.oneLineSummary
          : fallback.oneLineSummary,
      whySteps: Array.isArray(briefing.whySteps)
        ? briefing.whySteps.filter((step): step is string => typeof step === 'string')
        : fallback.whySteps,
      trendSignal: params.trendSignal,
      questions: Array.isArray(briefing.questions)
        ? briefing.questions
            .map((q) => q as Partial<KeywordBriefing['questions'][number]>)
            .filter((q) => typeof q.question === 'string' && typeof q.answer === 'string')
            .map((q, index) => ({
              question: q.question as string,
              answer: q.answer as string,
              interestCount:
                typeof q.interestCount === 'number'
                  ? q.interestCount
                  : Math.max(params.articleCount, 1) * 100 + index,
            }))
        : fallback.questions,
      essentialArticleIds:
        params.articleIds.length > 0
          ? params.articleIds.slice(0, 5)
          : fallback.essentialArticleIds,
    };
  }

  private buildTrendSignal(
    timeSeries: Array<{ scoreSum: number | string; freqSum: number | string }>,
  ): KeywordBriefingTrendSignal {
    const recent = timeSeries.slice(0, 3).reduce((sum, item) => sum + Number(item.scoreSum), 0);
    const previous = timeSeries.slice(3, 6).reduce((sum, item) => sum + Number(item.scoreSum), 0);
    const changeRate =
      previous > 0
        ? Math.round(((recent - previous) / previous) * 100)
        : recent > 0
          ? 100
          : 0;
    let label = '상승세 유지';
    if (changeRate >= 50) {
      label = '급상승';
    } else if (changeRate <= -20) {
      label = '관심 둔화';
    } else if (changeRate < 10) {
      label = '관심 유지';
    }
    return {
      label,
      changeRate,
      basis: '최근 3개 집계 구간 score_sum 기준',
    };
  }

}
