import { Module } from '@nestjs/common';
import { AnalyzerModule } from './analyzer/analyzer.module';
import { CollectorModule } from './collector/collector.module';
import { ConfigModule } from './common/config/config.module';
import { TrendModule } from './trend/trend.module';

@Module({
  imports: [ConfigModule, AnalyzerModule, CollectorModule, TrendModule],
})
export class AppModule {}



