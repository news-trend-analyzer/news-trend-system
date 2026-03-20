import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ArticleKeywordEntity } from './entities/article-keyword.entity';
import { Article } from '../types/article.type';
import { Keyword } from '../types/keyword.type';

export type ArticleByKeywordItem = {
  readonly id: number;
  readonly title: string;
  readonly bodyText: string;
  readonly publisher: string;
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

@Injectable()
export class ArticleKeywordRepository {
  constructor(
    @InjectRepository(ArticleKeywordEntity)
    private readonly articleKeywordRepository: Repository<ArticleKeywordEntity>,
    private readonly dataSource: DataSource,
  ) {}

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
   * @param params 검색 파라미터
   */
  async searchArticlesByKeyword(
    params: SearchArticlesByKeywordParams,
  ): Promise<SearchArticlesByKeywordResult> {
    const hoursInterval = params.hoursInterval ?? 24;
    const size = Math.min(Math.max(params.size ?? 20, 1), 50);
    const page = Math.max(params.page ?? 1, 1);
    const from = (page - 1) * size;
    const countQuery = `
    SELECT COUNT(DISTINCT a.id) AS total
    FROM keywords k
    JOIN article_keywords ak ON ak.keyword_id = k.id
    JOIN articles a ON a.id = ak.article_id
    WHERE (k.normalized_text = $1 OR k.display_text = $1)
      AND a.published_at >= NOW() - INTERVAL '1 hour' * $2
    `;
    const countResult = await this.dataSource.query(countQuery, [
      params.keyword,
      hoursInterval,
    ]);
    const total = Number.parseInt(countResult[0]?.total ?? '0', 10);
    const totalPages = Math.ceil(total / size);
    const dataQuery = `
    SELECT
      a.id,
      a.title,
      a.body_text,
      a.publisher,
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
      params.keyword,
      hoursInterval,
      size,
      from,
    ]);
    const items: ArticleByKeywordItem[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      bodyText: row.body_text,
      publisher: row.publisher,
      url: row.url,
      publishedAt: row.published_at,
      weight: row.weight,
    }));
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