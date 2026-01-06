import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TrendModule } from '../trend/trend.module';
import { CollectorController } from './controllers/collector.controller';
import { CollectorService } from './services/collector.service';
import { MessageQueueModule } from '../common/message-queue/message-queue.module';
import { ScraperService } from './services/scraper.service';
import { SchedulerService } from './services/scheduler.service';
import { ARTICLE_SINK } from './sink/article-sink';
import { FileArticleSink } from './sink/file-article-sink';

@Module({
  imports: [MessageQueueModule, ScheduleModule.forRoot(), TrendModule],
  controllers: [CollectorController],
  providers: [
    CollectorService,
    ScraperService,
    SchedulerService,
    {
      provide: ARTICLE_SINK,
      useClass: FileArticleSink,
    },
  ],
  exports: [CollectorService, ScraperService],
})
export class CollectorModule {}
