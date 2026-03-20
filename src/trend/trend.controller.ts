import { ClassSerializerInterceptor, Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { TrendAnalysisService } from './trend.service';
import { TrendItemDto } from './dto/trend-item.dto';
import { RealtimeTrendItemDto } from './dto/realtime-trend-item.dto';

@Controller('trend')
export class TrendController {
  constructor(private readonly trendService: TrendAnalysisService) {}

  /**
   * 상위 트렌드 키워드 조회
   * @param limit - 조회할 키워드 개수 (기본값: 20)
   * @returns 상위 트렌드 키워드 배열 (id는 응답에서 제외)
   */
  @Get('top')
  @UseInterceptors(ClassSerializerInterceptor)
  async getTopTrends(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const trends = await this.trendService.getTopTrends(limitNum);
    return trends.map((item) => plainToInstance(TrendItemDto, item));
  }

  /**
   * 실시간 트렌드 키워드 조회 (최근 1시간 화력 중심, 캐시 없음)
   * @param limit - 조회할 키워드 개수 (기본값: 50)
   */
  @Get('realtime')
  @UseInterceptors(ClassSerializerInterceptor)
  async getTrendsRealtime(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const trends = await this.trendService.getTrendsRealtime(limitNum);
    return trends.map((item) => plainToInstance(RealtimeTrendItemDto, item));
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

