import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ArticleKeywordEntity } from './entities/article-keyword.entity';
import { Article } from '../types/article.type';
import { Keyword } from '../types/keyword.type';

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
      AND a.published_at >= NOW() - INTERVAL '10 hours'
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

  async getRelatedKeywords(keywordId: number): Promise<Keyword[]> {
    const query = `
    WITH target_articles AS (
      SELECT ak.article_id
      FROM article_keywords ak
      JOIN articles a ON a.id = ak.article_id
      WHERE ak.keyword_id = $1
        AND a.published_at >= NOW() - INTERVAL '10 hours'
    )
    SELECT
      k2.id AS related_keyword_id,
      k2.display_text,
      COUNT(*) AS co_count,
      SUM(ak2.weight) AS weight_sum,
      (SUM(ak2.weight) * LN(COUNT(*) + 1)) AS association_score
    FROM target_articles ta
    JOIN article_keywords ak2 ON ak2.article_id = ta.article_id
    JOIN keywords k2 ON k2.id = ak2.keyword_id
    WHERE ak2.keyword_id <> $1
    GROUP BY k2.id, k2.display_text
    ORDER BY association_score DESC;
    `;
    const result = await this.dataSource.query(query, [keywordId]);
    return result.map((row) => ({
      id: row.related_keyword_id,
      displayText: row.display_text,
      coCount: row.co_count,
      weightSum: row.weight_sum,
      associationScore: row.association_score,
    }));
  }
}