import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MessageQueueModule } from '../common/message-queue/message-queue.module';
import { TrendAnalysisService } from './trend.service';
import { TrendController } from './trend.controller';
import { DatabaseModule } from '../common/database/database.module';

@Module({
  imports: [
    MessageQueueModule,
    BullModule.registerQueue({
      name: 'articles',
    }),
    DatabaseModule,
  ],
  controllers: [TrendController],
  providers: [TrendAnalysisService],
  exports: [TrendAnalysisService],
})
export class TrendModule {}

