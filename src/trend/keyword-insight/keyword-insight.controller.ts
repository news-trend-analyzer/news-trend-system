import {
  Controller,
  Get,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { KeywordInsightService } from './keyword-insight.service';
import { KeywordInsightItemDto } from './dto/keyword-insight-item.dto';

@Controller('trend/keyword-insight')
@UseInterceptors(ClassSerializerInterceptor)
export class KeywordInsightController {
  constructor(private readonly keywordInsightService: KeywordInsightService) {}

  /**
   * 상위 랭킹 키워드와 LLM 인사이트 조회
   * @param limit - 조회할 키워드 개수 (기본 20, 최대 50)
   */
  @Get()
  async getTopKeywordsWithInsights(@Query('limit') limit?: string) {
    const limitNum = limit ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50) : 20;
    const items = await this.keywordInsightService.getTopKeywordsWithInsights(limitNum);
    return items.map((item) => plainToInstance(KeywordInsightItemDto, item));
  }
}
