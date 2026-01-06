import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MessageQueueModule } from '../common/message-queue/message-queue.module';
import { TrendAnalysisService } from './trend.service';
import { TrendController } from './trend.controller';

@Module({
  imports: [
    MessageQueueModule,
    BullModule.registerQueue({
      name: 'articles',
    }),
  ],
  controllers: [TrendController],
  providers: [TrendAnalysisService],
  exports: [TrendAnalysisService],
})
export class TrendModule {}

