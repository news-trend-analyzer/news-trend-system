import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ArticleKeywordEntity } from './entities/article-keyword.entity';
import { Article } from '../types/article.type';
import { Keyword } from '../types/keyword.type';

const DESCRIPTION_MAX_LENGTH = 200;

export type ArticleByKeywordItem = {
  readonly title: string;
  readonly description: string | null;
  readonly publisher: string;
  readonly category: string | null;
  readonly url: string;
  readonly publishedAt: Date;
  readonly weight: number;
};

export type SearchArticlesByKeywordParams = {
  readonly keyword: string;
  readonly hoursInterval?: number;
  readonly page?: number;
  readonly size?: number;
};

export type SearchArticlesByKeywordResult = {
  readonly total: number;
  readonly items: ArticleByKeywordItem[];
  readonly page: number;
  readonly size: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
};

export type ArticleBodyForInsight = {
  readonly id: number;
  readonly title: string;
  readonly bodySnippet: string;
  readonly publisher: string;
  readonly url: string;
};

export type GetTopArticleBodiesByKeywordParams = {
  readonly keywordId: number;
  readonly hoursInterval?: number;
  readonly limit?: number;
  readonly maxCharsPerArticle?: number;
};

@Injectable()
export class ArticleKeywordRepository {
  constructor(
    @InjectRepository(ArticleKeywordEntity)
    private readonly articleKeywordRepository: Repository<ArticleKeywordEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 키워드 ID 기준 상위 기사 본문 조회 (LLM 인사이트용)
   * @param params keywordId, hoursInterval, limit, maxCharsPerArticle
   */
  async getTopArticleBodiesByKeyword(
    params: GetTopArticleBodiesByKeywordParams,
  ): Promise<ArticleBodyForInsight[]> {
    const hoursInterval = params.hoursInterval ?? 24;
    const limit = Math.min(Math.max(params.limit ?? 5, 1), 10);
    const maxChars = params.maxCharsPerArticle ?? 1500;
    const query = `
    SELECT
      a.id,
      a.title,
      a.body_text,
      a.publisher,
      a.url
    FROM article_keywords ak
    JOIN articles a ON a.id = ak.article_id
    WHERE ak.keyword_id = $1
      AND a.published_at >= NOW() - INTERVAL '1 hour' * $2
    ORDER BY ak.weight DESC, a.published_at DESC
    LIMIT $3
    `;
    const rows = await this.dataSource.query(query, [params.keywordId, hoursInterval, limit]);
    return rows.map((row) => {
      const bodyText = (row.body_text as string | null) ?? '';
      const trimmed = bodyText.trim();
      const snippet =
        trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}...`;
      return {
        id: Number(row.id),
        title: row.title as string,
        bodySnippet: snippet,
        publisher: row.publisher as string,
        url: row.url as string,
      };
    });
  }

  async getRelatedArticles(keywordId: number): Promise<Article[]> {
    const query = `
    SELECT
      a.id,
      a.publisher,
      a.title,
      a.url,
      a.published_at,
      ak.weight
    FROM article_keywords ak
    JOIN articles a ON a.id = ak.article_id
    WHERE ak.keyword_id = $1
      AND a.published_at >= NOW() - INTERVAL '24 hours'
    ORDER BY ak.weight DESC, a.published_at DESC
    LIMIT 5;
    `;
    const result = await this.dataSource.query(query, [keywordId]);
    return result.map((row) => ({
      id: row.id,
      publisher: row.publisher,
      title: row.title,
      url: row.url,
      publishedAt: row.published_at,
      weight: row.weight,
      bodySnippet: row.body_snippet,
    }));
  }

  /**
   * 키워드(normalized_text 또는 display_text)로 기사 검색
   * - 복합 키워드(BTS:공연) 시 : 기준 분리하여 1순위 정확 매칭, 2순위 단일 키워드 관련성 매칭
   * @param params 검색 파라미터
   */
  async searchArticlesByKeyword(
    params: SearchArticlesByKeywordParams,
  ): Promise<SearchArticlesByKeywordResult> {
    const hoursInterval = params.hoursInterval ?? 24;
    const size = Math.min(Math.max(params.size ?? 20, 1), 50);
    const page = Math.max(params.page ?? 1, 1);
    const from = (page - 1) * size;
    const keyword = params.keyword.trim();
    const parts = this.splitKeywordParts(keyword);
    const hasComposite = parts.length >= 2;
    if (!hasComposite) {
      return this.searchArticlesExactOnly(keyword, hoursInterval, size, page, from);
    }
    return this.searchArticlesWithPartialMatch(
      keyword,
      parts,
      hoursInterval,
      size,
      page,
      from,
    );
  }

  /**
   * 키워드를 : 기준으로 분리 (예: BTS:공연 → ['BTS', '공연'])
   */
  private splitKeywordParts(keyword: string): string[] {
    return keyword
      .split(':')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  /**
   * 단일/비복합 키워드: 정확 매칭만
   */
  private async searchArticlesExactOnly(
    keyword: string,
    hoursInterval: number,
    size: number,
    page: number,
    from: number,
  ): Promise<SearchArticlesByKeywordResult> {
    const countQuery = `
    SELECT COUNT(DISTINCT a.id) AS total
    FROM keywords k
    JOIN article_keywords ak ON ak.keyword_id = k.id
    JOIN articles a ON a.id = ak.article_id
    WHERE (k.normalized_text = $1 OR k.display_text = $1)
      AND a.published_at >= NOW() - INTERVAL '1 hour' * $2
    `;
    const countResult = await this.dataSource.query(countQuery, [keyword, hoursInterval]);
    const total = Number.parseInt(countResult[0]?.total ?? '0', 10);
    const totalPages = Math.ceil(total / size);
    const dataQuery = `
    SELECT
      a.title,
      a.body_text,
      a.publisher,
      a.category,
      a.url,
      a.published_at,
      ak.weight
    FROM keywords k
    JOIN article_keywords ak ON ak.keyword_id = k.id
    JOIN articles a ON a.id = ak.article_id
    WHERE (k.normalized_text = $1 OR k.display_text = $1)
      AND a.published_at >= NOW() - INTERVAL '1 hour' * $2
    ORDER BY ak.weight DESC
    LIMIT $3 OFFSET $4
    `;
    const rows = await this.dataSource.query(dataQuery, [
      keyword,
      hoursInterval,
      size,
      from,
    ]);
    const items = this.mapRowsToItems(rows);
    return {
      total,
      items,
      page,
      size,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  /**
   * 복합 키워드: 1순위 정확 매칭, 2순위 분리 단일 키워드 매칭 (중복 제거, weight·매칭률 정렬)
   */
  private async searchArticlesWithPartialMatch(
    keyword: string,
    parts: string[],
    hoursInterval: number,
    size: number,
    page: number,
    from: number,
  ): Promise<SearchArticlesByKeywordResult> {
    const countQuery = `
    WITH exact_match AS (
      SELECT ak.article_id
      FROM keywords k
      JOIN article_keywords ak ON ak.keyword_id = k.id
      JOIN articles a ON a.id = ak.article_id
      WHERE (k.normalized_text = $1 OR k.display_text = $1)
        AND a.published_at >= NOW() - INTERVAL '1 hour' * $3
    ),
    partial_match AS (
      SELECT ak.article_id
      FROM keywords k
      JOIN article_keywords ak ON ak.keyword_id = k.id
      JOIN articles a ON a.id = ak.article_id
      WHERE (
        k.normalized_text = ANY($2::text[])
        OR k.display_text = ANY($2::text[])
        OR LOWER(k.normalized_text) IN (SELECT LOWER(x) FROM unnest($2::text[]) AS x)
      )
        AND a.published_at >= NOW() - INTERVAL '1 hour' * $3
    )
    SELECT COUNT(*) AS total
    FROM (SELECT article_id FROM exact_match UNION SELECT article_id FROM partial_match) u
    `;
    const countResult = await this.dataSource.query(countQuery, [
      keyword,
      parts,
      hoursInterval,
    ]);
    const total = Number.parseInt(countResult[0]?.total ?? '0', 10);
    const totalPages = Math.ceil(total / size);
    const partsCount = parts.length;
    const dataQuery = `
    WITH exact_match AS (
      SELECT ak.article_id, ak.weight, 1 AS match_rank, 1.0 AS match_rate
      FROM keywords k
      JOIN article_keywords ak ON ak.keyword_id = k.id
      JOIN articles a ON a.id = ak.article_id
      WHERE (k.normalized_text = $1 OR k.display_text = $1)
        AND a.published_at >= NOW() - INTERVAL '1 hour' * $3
    ),
    partial_match AS (
      SELECT
        ak.article_id,
        SUM(ak.weight) AS weight,
        2 AS match_rank,
        COUNT(DISTINCT k.id)::float / $4 AS match_rate
      FROM keywords k
      JOIN article_keywords ak ON ak.keyword_id = k.id
      JOIN articles a ON a.id = ak.article_id
      WHERE (
        k.normalized_text = ANY($2::text[])
        OR k.display_text = ANY($2::text[])
        OR LOWER(k.normalized_text) IN (SELECT LOWER(x) FROM unnest($2::text[]) AS x)
      )
        AND a.published_at >= NOW() - INTERVAL '1 hour' * $3
        AND ak.article_id NOT IN (SELECT article_id FROM exact_match)
      GROUP BY ak.article_id
    ),
    combined AS (
      SELECT * FROM exact_match
      UNION ALL
      SELECT * FROM partial_match
    ),
    ranked AS (
      SELECT
        c.article_id,
        c.weight,
        c.match_rank,
        c.match_rate,
        ROW_NUMBER() OVER (PARTITION BY c.article_id ORDER BY c.match_rank, c.weight DESC) AS rn
      FROM combined c
    )
    SELECT
      a.title,
      a.body_text,
      a.publisher,
      a.category,
      a.url,
      a.published_at,
      r.weight
    FROM ranked r
    JOIN articles a ON a.id = r.article_id
    WHERE r.rn = 1
    ORDER BY r.match_rank, r.weight DESC, r.match_rate DESC
    LIMIT $5 OFFSET $6
    `;
    const rows = await this.dataSource.query(dataQuery, [
      keyword,
      parts,
      hoursInterval,
      partsCount,
      size,
      from,
    ]);
    const items = this.mapRowsToItems(rows);
    return {
      total,
      items,
      page,
      size,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  private mapRowsToItems(rows: Record<string, unknown>[]): ArticleByKeywordItem[] {
    return rows.map((row) => ({
      title: row.title as string,
      description: this.truncateToDescription(row.body_text as string | null),
      publisher: row.publisher as string,
      category: (row.category as string | null) ?? null,
      url: row.url as string,
      publishedAt: row.published_at as Date,
      weight: row.weight as number,
    }));
  }

  private truncateToDescription(bodyText: string | null): string | null {
    if (!bodyText || bodyText.trim().length === 0) {
      return null;
    }
    const trimmed = bodyText.trim();
    if (trimmed.length <= DESCRIPTION_MAX_LENGTH) {
      return trimmed;
    }
    return `${trimmed.slice(0, DESCRIPTION_MAX_LENGTH)}...`;
  }

  async getRelatedKeywords(keywordId: number, limit: number): Promise<Keyword[]> {
    const query = `
    WITH target_articles AS (
      SELECT ak.article_id
      FROM article_keywords ak
      JOIN articles a ON a.id = ak.article_id
      WHERE ak.keyword_id = $1
        AND a.published_at >= NOW() - INTERVAL '24 hours'
    )
    SELECT
      k2.id AS related_keyword_id,
      k2.normalized_text,
      COUNT(*) AS co_count,
      SUM(ak2.weight) AS weight_sum,
      (SUM(ak2.weight) * LN(COUNT(*) + 1)) AS association_score
    FROM target_articles ta
    JOIN article_keywords ak2 ON ak2.article_id = ta.article_id
    JOIN keywords k2 ON k2.id = ak2.keyword_id
    WHERE ak2.keyword_id <> $1
    GROUP BY k2.id, k2.normalized_text
    ORDER BY association_score DESC
    LIMIT $2;
    `;
    const result = await this.dataSource.query(query, [keywordId, limit]);
    return result.map((row) => ({
      id: row.related_keyword_id,
      normalizedText: row.normalized_text,
      coCount: row.co_count,
      weightSum: row.weight_sum,
      associationScore: row.association_score,
    }));
  }
}