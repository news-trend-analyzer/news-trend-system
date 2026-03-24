import { Module } from '@nestjs/common';
import { ConfigModule } from '../../../common/config/config.module';
import { OpenAILlmService } from './openai-llm.service';

@Module({
  imports: [ConfigModule],
  providers: [OpenAILlmService],
  exports: [OpenAILlmService],
})
export class LlmModule {}
