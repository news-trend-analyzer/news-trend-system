import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyzerModule } from './analyzer/analyzer.module';
import { CollectorModule } from './collector/collector.module';
import { ConfigModule } from './common/config/config.module';
import { TrendModule } from './trend/trend.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    AnalyzerModule,
    CollectorModule,
    TrendModule,
  ],
})
export class AppModule {}



