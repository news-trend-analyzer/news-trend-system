import { Controller, Get, Query } from '@nestjs/common';
import { DataReportService } from '../data-report/data-report.service';
import { GetRankingDto, GetTimeSeriesDto } from '../dto/report.dto';

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
}

