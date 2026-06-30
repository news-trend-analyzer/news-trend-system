import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MessageQueueModule } from '../common/message-queue/message-queue.module';
import { TrendAnalysisService } from './trend.service';
import { TrendController } from './trend.controller';
import { DatabaseModule } from '../common/database/database.module';
import { DataReportController } from './data-report/data-report.controller';
import { DataReportService } from './data-report/data-report.service';
import { KeywordInsightModule } from './keyword-insight/keyword-insight.module';
import { LlmModule } from './keyword-insight/llm/llm.module';
import { TrendKeywordQueryService } from './trend-keyword-query.service';
import { CoupangAffiliateController } from './affiliate/coupang-affiliate.controller';
import { CoupangAffiliateService } from './affiliate/coupang-affiliate.service';

@Module({
  imports: [
    MessageQueueModule,
    BullModule.registerQueue({
      name: 'articles',
    }),
    DatabaseModule,
    KeywordInsightModule,
    LlmModule,
  ],
  controllers: [TrendController, DataReportController, CoupangAffiliateController],
  providers: [
    TrendAnalysisService,
    DataReportService,
    TrendKeywordQueryService,
    CoupangAffiliateService,
  ],
  exports: [TrendAnalysisService, DataReportService],
})
export class TrendModule {}
