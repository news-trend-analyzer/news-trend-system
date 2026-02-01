import { Controller, Get, Query } from '@nestjs/common';
import { DataReportService } from '../data-report/data-report.service';
import { GetRankingDto, GetTimeSeriesDto, GetRelatedArticlesDto, GetRelatedKeywordsDto } from '../dto/report.dto';

@Controller('data-report')
export class DataReportController {
  constructor(private readonly dataReportService: DataReportService) {}

  // 1시간 단위 키워드 랭킹 조회 (최근 12개의 버킷 시간)
  @Get('ranking')
  async getRanking( @Query() dto: GetRankingDto) {
    return this.dataReportService.getRanking(dto);
  }

  @Get('time-series')
  async getTimeSeries( @Query() dto: GetTimeSeriesDto) {
    return this.dataReportService.getTimeSeries(dto);
  }

  /**
   * 전체 보유 키워드 개수 조회
   */
  @Get('count-keywords')
  async getCountKeywords() {
    return this.dataReportService.getCountKeywords();
  }

  @Get('count-articles')
  async getCountArticles() {
    return this.dataReportService.getCountArticles();
  }

  @Get('related-articles')
  async getRelatedArticles(@Query() dto: GetRelatedArticlesDto) {
    return this.dataReportService.getRelatedArticles(dto.keywordId);
  }

  @Get('related-keywords')
  async getRelatedKeywords(@Query() dto: GetRelatedKeywordsDto) {
    return this.dataReportService.getRelatedKeywords(dto.keywordId);
  }
}

