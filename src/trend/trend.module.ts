import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MessageQueueModule } from '../common/message-queue/message-queue.module';
import { TrendAnalysisService } from './trend.service';
import { TrendController } from './trend.controller';
import { DatabaseModule } from '../common/database/database.module';
import { DataReportController } from './data-report/data-report.controller';
import { DataReportService } from './data-report/data-report.service';
@Module({
  imports: [
    MessageQueueModule,
    BullModule.registerQueue({
      name: 'articles',
    }),
    DatabaseModule,
  ],
  controllers: [TrendController, DataReportController],
  providers: [TrendAnalysisService, DataReportService],
  exports: [TrendAnalysisService, DataReportService],
})
export class TrendModule {}

