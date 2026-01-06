import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { TrendAnalysisService } from '../../trend/trend.service';
import { CollectorService } from './collector.service';
import { ScraperService } from './scraper.service';

/**
 * 수집 및 스크래핑 스케줄러 서비스
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private isScraping = false;
  private readonly articlesFilePath = path.join(
    process.cwd(),
    'data',
    'articles.jsonl',
  );

  constructor(
    private readonly collectorService: CollectorService,
    private readonly scraperService: ScraperService,
    private readonly trendService: TrendAnalysisService,
  ) {}

  /**
   * RSS 피드 수집 (3분마다 실행)
   * 수집 완료 후 자동으로 스크래핑 실행
   */
  @Cron('*/3 * * * *')
  async collectRSS() {
    this.logger.log('📰 RSS 피드 수집 시작 (스케줄러)');
    try {
      const result = await this.collectorService.collect();
      this.logger.log(
        `✅ RSS 피드 수집 완료: ${result.savedCount}건 저장 (${result.took}ms)`,
      );
      await this.scrapeArticles();
    } catch (error) {
      this.logger.error(
        '❌ RSS 피드 수집 실패',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * 스크래핑 실행 (RSS 수집 완료 후 자동 실행, 중복 실행 방지)
   */
  private async scrapeArticles() {
    if (this.isScraping) {
      this.logger.warn('⚠️  스크래핑이 이미 실행 중입니다. 건너뜁니다.');
      return;
    }
    if (!fs.existsSync(this.articlesFilePath)) {
      this.logger.warn(
        '⚠️  articles.jsonl 파일이 없습니다. 스크래핑을 건너뜁니다.',
      );
      return;
    }
    this.isScraping = true;
    this.logger.log('🔍 스크래핑 시작 (스케줄러)');
    try {
      const result = await this.scraperService.scrapeArticles();
      this.logger.log(
        `✅ 스크래핑 완료: 성공 ${result.successCount}건, 실패 ${result.failureCount}건`,
      );
      if (fs.existsSync(this.articlesFilePath)) {
        this.clearArticlesFile();
      }
    } catch (error) {
      this.logger.error(
        '❌ 스크래핑 실패',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isScraping = false;
    }
  }

  /**
   * 트렌드 랭킹 스냅샷 저장 (3분마다 실행)
   */
  @Cron('*/3 * * * *')
  async saveTrendSnapshot() {
    this.logger.log('📸 트렌드 랭킹 스냅샷 저장 시작');
    try {
      await this.trendService.saveSnapshot();
    } catch (error) {
      this.logger.error(
        '❌ 트렌드 랭킹 스냅샷 저장 실패',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * articles.jsonl 파일 초기화
   */
  private clearArticlesFile(): void {
    try {
      if (fs.existsSync(this.articlesFilePath)) {
        fs.unlinkSync(this.articlesFilePath);
        this.logger.log(`🗑️  articles.jsonl 파일이 초기화되었습니다.`);
      } else {
        this.logger.log('📄 articles.jsonl 파일이 없습니다.');
      }
    } catch (error) {
      this.logger.error(
        `❌ articles.jsonl 파일 초기화 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

