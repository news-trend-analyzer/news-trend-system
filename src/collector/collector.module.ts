import { Module } from '@nestjs/common';
import { CollectorController } from './controllers/collector.controller';
import { CollectorService } from './services/collector.service';
import { MessageQueueModule } from '../common/message-queue/message-queue.module';
import { ScraperService } from './services/scraper.service';
import { SchedulerService } from './services/scheduler.service';
import { ARTICLE_SINK } from './sink/article-sink';
import { FileArticleSink } from './sink/file-article-sink';
import { CompositeArticleSink } from './sink/composite-article-sink';
import { ElasticsearchModule } from '../common/elasticsearch/elasticsearch.module';
import { ArticleSearchController } from './controllers/article-search.controller';
import { ArticleSearchByKeywordService } from './services/article-search-by-keyword.service';
import { DatabaseModule } from '../common/database/database.module';

@Module({
  imports: [
    MessageQueueModule,
    ElasticsearchModule,
    DatabaseModule,
  ],
  controllers: [CollectorController, ArticleSearchController],
  providers: [
    ArticleSearchByKeywordService,
    CollectorService,
    ScraperService,
    SchedulerService,
    FileArticleSink,
    {
      provide: ARTICLE_SINK,
      useClass: CompositeArticleSink,
    },
  ],
  exports: [CollectorService, ScraperService],
})
export class CollectorModule {}
