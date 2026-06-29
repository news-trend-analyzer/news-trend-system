import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArticleKeywordRepository } from '../common/database/article-keyword.repository';
import {
  TrendKeywordQueryRepository,
  TrendKeywordQuerySnapshot,
} from '../common/database/trend-keyword-query.repository';
import type { RankedKeyword } from '../common/types/top-keyword.type';
import { OpenAILlmService } from './keyword-insight/llm/openai-llm.service';

const DEFAULT_WINDOW_HOURS = 12;
const DEFAULT_QUERY_LIMIT = 20;
const ARTICLES_PER_KEYWORD = 5;
const MAX_CHARS_PER_ARTICLE = 1500;

export type ActiveTrendKeywordQuery = {
  keywordId: number;
  title: string;
  searchQuery: string;
};

type RankedKeywordTarget = {
  keyword: RankedKeyword;
  rank: number;
};

@Injectable()
export class TrendKeywordQueryService {
  private readonly logger = new Logger(TrendKeywordQueryService.name);
  private readonly windowHours: number;
  private readonly queryLimit: number;
  private generationInFlight: Promise<Map<number, ActiveTrendKeywordQuery>> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly articleKeywordRepository: ArticleKeywordRepository,
    private readonly trendKeywordQueryRepository: TrendKeywordQueryRepository,
    private readonly llmService: OpenAILlmService,
  ) {
    this.windowHours = this.configService.get<number>(
      'TREND_KEYWORD_QUERY_WINDOW_HOURS',
      DEFAULT_WINDOW_HOURS,
    );
    this.queryLimit = this.configService.get<number>(
      'TREND_KEYWORD_QUERY_LIMIT',
      DEFAULT_QUERY_LIMIT,
    );
  }

  async getActiveQueryMap(
    rankedKeywords: readonly RankedKeyword[],
  ): Promise<Map<number, ActiveTrendKeywordQuery>> {
    const targets = rankedKeywords.slice(0, this.queryLimit);
    const targetIds = targets.map((keyword) => Number(keyword.id));
    if (targetIds.length === 0) {
      return new Map();
    }

    const activeMap = await this.tryFindActiveMap(targetIds);
    if (activeMap.size >= targetIds.length) {
      return activeMap;
    }

    const missingTargets = targets
      .map((keyword, index) => ({ keyword, rank: index + 1 }))
      .filter((target) => !activeMap.has(Number(target.keyword.id)));
    if (missingTargets.length === 0) {
      return activeMap;
    }

    if (this.generationInFlight) {
      const generatedMap = await this.generationInFlight;
      return new Map([...activeMap, ...generatedMap]);
    }

    this.generationInFlight = this.generateSnapshot(missingTargets).finally(() => {
      this.generationInFlight = null;
    });
    const generatedMap = await this.generationInFlight;
    return new Map([...activeMap, ...generatedMap]);
  }

  private async tryFindActiveMap(
    keywordIds: number[],
  ): Promise<Map<number, ActiveTrendKeywordQuery>> {
    try {
      const rows = await this.trendKeywordQueryRepository.findActiveByKeywordIds(
        keywordIds,
        this.windowHours,
      );
      return new Map(
        [...rows.entries()].map(([keywordId, row]) => [
          keywordId,
          {
            keywordId,
            title: row.title,
            searchQuery: row.searchQuery,
          },
        ]),
      );
    } catch (err) {
      if (this.isMissingTableError(err)) {
        this.logger.warn(
          'trend_keyword_queries 테이블이 없어 원본 키워드로 응답합니다. 마이그레이션을 먼저 적용하세요.',
        );
        return new Map();
      }
      throw err;
    }
  }

  private async generateSnapshot(
    targets: readonly RankedKeywordTarget[],
  ): Promise<Map<number, ActiveTrendKeywordQuery>> {
    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - this.windowHours * 60 * 60 * 1000,
    );
    const expiresAt = new Date(
      periodEnd.getTime() + this.windowHours * 60 * 60 * 1000,
    );
    const generatedAt = new Date();
    const rows: TrendKeywordQuerySnapshot[] = [];

    for (const target of targets) {
      const { keyword, rank } = target;
      const keywordId = Number(keyword.id);
      const sourceKeyword = keyword.displayText?.trim() || keyword.normalizedText;
      const articles = await this.articleKeywordRepository.getTopArticleBodiesByKeyword({
        keywordId,
        hoursInterval: this.windowHours,
        limit: ARTICLES_PER_KEYWORD,
        maxCharsPerArticle: MAX_CHARS_PER_ARTICLE,
      });
      const result = await this.llmService.generateTrendKeywordQuery({
        keyword: sourceKeyword,
        articleSummaries: articles,
      });
      rows.push({
        keywordId,
        windowHours: this.windowHours,
        periodStart,
        periodEnd,
        rank,
        sourceKeyword,
        title: result.title,
        searchQuery: result.searchQuery,
        intentSummary: result.intentSummary,
        articleIds: articles.map((article) => article.id),
        generatedAt,
        expiresAt,
      });
    }

    try {
      await this.trendKeywordQueryRepository.saveSnapshotRows(rows);
    } catch (err) {
      if (this.isMissingTableError(err)) {
        this.logger.warn(
          'trend_keyword_queries 테이블이 없어 생성한 검색어를 저장하지 못했습니다.',
        );
      } else {
        throw err;
      }
    }

    return new Map(
      rows.map((row) => [
        row.keywordId,
        {
          keywordId: row.keywordId,
          title: row.title,
          searchQuery: row.searchQuery,
        },
      ]),
    );
  }

  private isMissingTableError(err: unknown): boolean {
    const maybeError = err as { code?: string; message?: string };
    return (
      maybeError.code === '42P01' ||
      Boolean(
        maybeError.message?.includes(
          'relation "trend_keyword_queries" does not exist',
        ),
      )
    );
  }
}
