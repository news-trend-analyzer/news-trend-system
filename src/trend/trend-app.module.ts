import { Module } from '@nestjs/common';
import { TrendModule } from './trend.module';
import { ConfigModule } from '../common/config/config.module';

/**
 * Trend 서비스 전용 AppModule
 * Trend와 관련된 모듈만 포함
 */
@Module({
  imports: [ConfigModule, TrendModule],
})
export class TrendAppModule {}


