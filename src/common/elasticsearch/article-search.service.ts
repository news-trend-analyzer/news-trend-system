import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Article } from '../../collector/models/article.model';

type ArticleSearchDocument = {
  readonly id: string;
  readonly title: string;
  readonly link: string;
  readonly press: string;
  readonly category: string;
  readonly description: string | null;
  readonly pubDate: string | null;
  readonly collectedAt: string;
};

type SearchArticlesParams = {
  readonly query: string;
  readonly from?: number;
  readonly size?: number;
};

type SearchArticlesResultItem = {
  readonly id: string;
  readonly title: string;
  readonly link: string;
  readonly press: string;
  readonly category: string;
  readonly description: string | null;
  readonly pubDate: string | null;
  readonly collectedAt: string;
};

type SearchArticlesResult = {
  readonly total: number;
  readonly items: SearchArticlesResultItem[];
  readonly page: number;
  readonly size: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
};

/**
 * 기사 Elasticsearch 색인 서비스
 * - 인덱스 존재 여부 확인 및 생성
 * - 기사 단건 및 배치 색인
 */
@Injectable()
export class ArticleSearchService implements OnModuleInit {
  private readonly logger = new Logger(ArticleSearchService.name);
  private readonly indexName: string;

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly configService: ConfigService,
  ) {
    this.indexName = this.configService.get<string>(
      'ELASTICSEARCH_INDEX_ARTICLES',
      'news-articles',
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureIndex();
      this.logger.log(`Elasticsearch index ready: ${this.indexName}`);
    } catch (error) {
      this.logger.error(
        `Failed to ensure Elasticsearch index: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * 기사 검색
   * @param params 검색 파라미터
   */
  async searchArticles(params: SearchArticlesParams): Promise<SearchArticlesResult> {
    const from = Math.max(0, params.from ?? 0);
    const requestedSize = params.size ?? 10;
    const size = Math.min(requestedSize, 50);
    const page = Math.floor(from / size) + 1;
    const normalizedQuery = this.normalizeSearchQuery(params.query);
    const response = await this.elasticsearchService.search<ArticleSearchDocument>({
      index: this.indexName,
      from,
      size,
      query: {
        bool: {
          should: [
            {
              match: {
                title: {
                  query: normalizedQuery,
                  operator: 'and',
                  boost: 2.0,
                },
              },
            },
            {
              match: {
                title: {
                  query: normalizedQuery,
                  operator: 'or',
                },
              },
            },
          ],
          minimum_should_match: 1,
        },
      },
      sort: [
        {
          collectedAt: {
            order: 'desc',
          },
        },
      ],
    });
    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total?.value ?? 0);
    const totalPages = Math.ceil(total / size);
    const items: SearchArticlesResultItem[] = response.hits.hits
      .map((hit) => hit._source)
      .filter((source): source is ArticleSearchDocument => Boolean(source))
      .map((source) => ({
        id: source.id,
        title: source.title,
        link: source.link,
        press: source.press,
        category: source.category,
        description: source.description,
        pubDate: source.pubDate,
        collectedAt: source.collectedAt,
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

  async indexArticle(article: Article): Promise<void> {
    const document = this.mapArticle(article);
    await this.elasticsearchService.index({
      index: this.indexName,
      id: document.id,
      document,
    });
  }

  async bulkIndexArticles(articles: Article[]): Promise<void> {
    if (articles.length === 0) {
      return;
    }
    try {
      const operations = articles.flatMap((article) => {
        const document = this.mapArticle(article);
        return [
          { index: { _index: this.indexName, _id: document.id } },
          document,
        ];
      });
      const result = await this.elasticsearchService.bulk({
        operations,
        refresh: false,
      });
      if (result.errors) {
        const failedItems = (result.items ?? []).filter((item: unknown) => {
          const indexResult = (item as { index?: { error?: unknown } }).index;
          return Boolean(indexResult?.error);
        });
        const sampleErrors = failedItems.slice(0, 3);
        this.logger.warn(
          `Failed to index some articles to ${this.indexName}. ` +
            `failedCount=${failedItems.length}, total=${articles.length}, sampleErrors=${JSON.stringify(sampleErrors)}`,
        );
      } else {
        this.logger.log(
          `Successfully indexed ${articles.length} articles to ${this.indexName}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Elasticsearch bulk index failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async ensureIndex(): Promise<void> {
    try {
      const exists = await this.elasticsearchService.indices.exists({
        index: this.indexName,
      });
      if (exists) {
        this.logger.log(`Elasticsearch index already exists: ${this.indexName}`);
        return;
      }
      await this.elasticsearchService.indices.create({
        index: this.indexName,
        settings: {
          analysis: {
            filter: {
              title_edge_ngram: {
                type: 'edge_ngram',
                min_gram: 1,
                max_gram: 20,
              },
            },
            analyzer: {
              title_ngram_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'title_edge_ngram'],
              },
              title_search_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase'],
              },
            },
          },
          index: {
            number_of_shards: 1,
            number_of_replicas: 0,
          },
        },
        mappings: {
          properties: {
            id: { type: 'keyword' },
            title: {
              type: 'text',
              analyzer: 'title_ngram_analyzer',
              search_analyzer: 'title_search_analyzer',
            },
            link: { type: 'keyword' },
            press: { type: 'keyword' },
            category: { type: 'keyword' },
            description: { type: 'text' },
            pubDate: {
              type: 'date',
              format:
                'EEE, d MMM yyyy HH:mm:ss Z||EEE, dd MMM yyyy HH:mm:ss Z||strict_date_optional_time',
            },
            collectedAt: { type: 'date', format: 'strict_date_optional_time' },
          },
        },
      });
      this.logger.log(`Created Elasticsearch index: ${this.indexName}`);
    } catch (error) {
      this.logger.error(
        `Failed to ensure Elasticsearch index ${this.indexName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private mapArticle(article: Article): ArticleSearchDocument {
    return {
      id: article.link,
      title: article.title,
      link: article.link,
      press: article.press,
      category: article.category,
      description: article.description,
      pubDate: article.pubDate,
      collectedAt: article.collectedAt,
    };
  }

  /**
   * 검색어 정규화
   * 콜론(:), 쉼표(,) 등 특수문자를 공백으로 치환하여 검색 정확도 향상
   * @param query 원본 검색어
   * @returns 정규화된 검색어
   */
  private normalizeSearchQuery(query: string): string {
    return query
      .replace(/[:,\/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

