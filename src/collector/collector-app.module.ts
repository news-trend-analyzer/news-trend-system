import { Module } from '@nestjs/common';
import { CollectorModule } from './collector.module';
import { ConfigModule } from '../common/config/config.module';

/**
 * Collector 서비스 전용 AppModule
 * Collector와 관련된 모듈만 포함
 */
@Module({
  imports: [ConfigModule, CollectorModule],
})
export class CollectorAppModule {}


