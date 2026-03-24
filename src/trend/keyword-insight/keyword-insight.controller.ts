import {
  Controller,
  Get,
  Param,
  Query,
  UseInterceptors,
  NotFoundException,
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

  /**
   * 키워드 ID로 LLM 인사이트 단건 조회
   * @param keywordId - 조회할 키워드 ID
   */
  @Get(':keywordId')
  async getInsightByKeywordId(@Param('keywordId') keywordId: string) {
    const id = parseInt(keywordId, 10);
    if (Number.isNaN(id) || id < 1) {
      throw new NotFoundException('유효하지 않은 키워드 ID입니다.');
    }
    const item = await this.keywordInsightService.getInsightByKeywordId(id);
    if (!item) {
      throw new NotFoundException('키워드를 찾을 수 없습니다.');
    }
    return plainToInstance(KeywordInsightItemDto, item);
  }
}
