import { Controller, Get, Query } from '@nestjs/common';
import { TrendAnalysisService } from './trend.service';

@Controller('trend')
export class TrendController {
  constructor(private readonly trendService: TrendAnalysisService) {}

  /**
   * 상위 트렌드 키워드 조회
   * @param limit - 조회할 키워드 개수 (기본값: 20)
   * @returns 상위 트렌드 키워드 배열
   */
  @Get('top')
  async getTopTrends(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.trendService.getTopTrends(limitNum);
  }

  /**
   * 특정 키워드의 트렌드 정보 조회
   * @param keyword - 조회할 키워드
   * @returns 키워드 트렌드 정보
   */
  @Get('keyword')
  async getKeywordTrend(@Query('keyword') keyword: string) {
    if (!keyword) {
      throw new Error('keyword 파라미터가 필요합니다.');
    }
    return this.trendService.getKeywordTrend(keyword);
  }
}

