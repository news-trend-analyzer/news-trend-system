import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullMQMessageQueueService } from './bullmq-message-queue.service';
import { MESSAGE_QUEUE } from './message-queue.interface';
import { RedisDedupeService } from './redis-dedupe.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
          db: configService.get<number>('REDIS_DB', 0),
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'articles',
    }),
  ],
  providers: [
    RedisDedupeService,
    {
      provide: MESSAGE_QUEUE,
      useClass: BullMQMessageQueueService,
    },
  ],
  exports: [MESSAGE_QUEUE, BullModule, RedisDedupeService],
})
export class MessageQueueModule {}

