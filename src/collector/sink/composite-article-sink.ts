import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArticleSink } from './article-sink';
import { Article } from '../models/article.model';
import { FileArticleSink } from './file-article-sink';
import { ArticleSearchService } from '../../common/elasticsearch/article-search.service';

/**
 * 파일 저장과 Elasticsearch 색인을 동시에 수행하는 ArticleSink 구현체
 */
@Injectable()
export class CompositeArticleSink implements ArticleSink {
  private readonly logger = new Logger(CompositeArticleSink.name);

  constructor(
    private readonly fileArticleSink: FileArticleSink,
    private readonly articleSearchService: ArticleSearchService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 기사 배열을 파일로 저장하고 Elasticsearch에 배치 색인
   * - 파일 저장은 항상 시도
   * - Elasticsearch 색인은 실패해도 수집 전체가 실패하지 않도록 예외 처리
   * @param items - 저장 및 색인할 기사 배열
   */
  async save(items: Article[]): Promise<void> {
    if (!items.length) {
      return;
    }
    await this.fileArticleSink.save(items);
    const isSearchIndexEnabled = this.getIsSearchIndexEnabled();
    if (!isSearchIndexEnabled) {
      this.logger.debug('Elasticsearch indexing is disabled by config');
      return;
    }
    try {
      await this.articleSearchService.bulkIndexArticles(items);
    } catch (error) {
      this.logger.error(
        `Failed to index articles to Elasticsearch: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private getIsSearchIndexEnabled(): boolean {
    const flag = this.configService.get<string>('ENABLE_ARTICLE_SEARCH_INDEX', 'true');
    return flag.toLowerCase() === 'true';
  }
}


