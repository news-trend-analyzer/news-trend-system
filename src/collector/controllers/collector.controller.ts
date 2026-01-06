import { Controller, Get } from '@nestjs/common';
import { CollectorService } from '../services/collector.service';
import { ScraperService } from '../services/scraper.service';
import { CollectAndScrapeResult } from '../models/collector.model';

@Controller('collector')
export class CollectorController {
  constructor(
    private readonly collectorService: CollectorService,
    private readonly scraperService: ScraperService,
  ) {}

  /**
   * RSS 수집 테스트
   * @returns 수집 결과
   */
  @Get('admin/test')
  async testCollect() {
    return await this.collectorService.collect();
  }

  /**
   * 스크래핑 테스트 (기본 경로 사용)
   * @returns 스크래핑 결과
   */
  @Get('admin/test-scrape')
  async testScrape() {
    return await this.scraperService.scrapeArticles();
  }

  /**
   * RSS 수집 및 스크래핑 통합 실행
   * 1. RSS 피드에서 기사 수집 → 파일 저장
   * 2. 파일에서 읽어서 스크래핑 → 큐에 넣기
   * @returns 통합 실행 결과
   */
  @Get('admin/collect-and-scrape')
  async collectAndScrape(): Promise<CollectAndScrapeResult> {
    const started = Date.now();
    const collectResult = await this.collectorService.collect();
    const scrapeStarted = Date.now();
    const scrapeResult = await this.scraperService.scrapeArticles();
    const totalTook = Date.now() - started;
    return {
      collect: collectResult,
      scrape: {
        successCount: scrapeResult.successCount,
        failureCount: scrapeResult.failureCount,
        totalTook: Date.now() - scrapeStarted,
      },
    };
  }
}

