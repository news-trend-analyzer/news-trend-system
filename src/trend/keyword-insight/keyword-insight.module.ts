import { Module } from '@nestjs/common';
import { ConfigModule } from '../../common/config/config.module';
import { DatabaseModule } from '../../common/database/database.module';
import { LlmModule } from './llm/llm.module';
import { KeywordInsightService } from './keyword-insight.service';
import { KeywordInsightController } from './keyword-insight.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, LlmModule],
  controllers: [KeywordInsightController],
  providers: [KeywordInsightService],
  exports: [KeywordInsightService],
})
export class KeywordInsightModule {}
