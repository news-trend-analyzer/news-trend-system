import { Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { NewsArticle, ScrapedArticle } from '../models/article.model';
import { ScrapeResult, ScrapeArticleParams } from '../models/scraper.model';
import { MESSAGE_QUEUE, MessageQueue } from '../../common/message-queue/message-queue.interface';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly concurrencyLimit = 5;

  constructor(
    @Inject(MESSAGE_QUEUE)
    private readonly messageQueue: MessageQueue<ScrapedArticle>,
  ) {}

  /**
   * 기사 목록을 읽어서 본문을 스크래핑하여 저장
   * @param inputPath - 입력 파일 경로 (JSONL 형식)
   * @param outputPath - 출력 파일 경로 (JSONL 형식)
   * @returns 스크래핑 결과
   */
  async scrapeArticles(
    inputPath?: string,
    outputPath?: string,
  ): Promise<ScrapeResult> {
    const defaultInputPath = path.join(process.cwd(), 'data', 'articles.jsonl');
    const defaultOutputPath = path.join(
      process.cwd(),
      'data',
      'crawled_results.jsonl',
    );
    const finalInputPath = inputPath ?? defaultInputPath;
    const finalOutputPath = outputPath ?? defaultOutputPath;
    this.initializeOutputFile(finalOutputPath);
    const articles = this.loadArticles(finalInputPath);
    this.logger.log(
      `${articles.length}건의 수집을 시작합니다. 실시간으로 파일에 기록됩니다.`,
    );
    const selectorMap = this.getSelectorMap();
    const result = await this.scrapeBatched(
      articles,
      finalOutputPath,
      selectorMap,
    );
    this.logger.log(`수집 종료. 결과 파일: ${finalOutputPath}`);
    return result;
  }

  /**
   * 출력 파일 초기화 (기존 내용 삭제)
   */
  private initializeOutputFile(outputPath: string): void {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }

  /**
   * JSONL 파일에서 기사 목록 로드
   */
  private loadArticles(inputPath: string): NewsArticle[] {
    const rawData = fs.readFileSync(inputPath, 'utf-8');
    return rawData
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as NewsArticle);
  }

  /**
   * 도메인별 CSS 셀렉터 맵 반환
   */
  private getSelectorMap(): Record<string, string[]> {
    return {
      'yna.co.kr': ['article', '.story-news', '.article'],
      'yonhapnewstv.co.kr': ['#articleBody', '.article_content'],
      'jtbc.co.kr': ['#article_body', '.article_content'],
      'kmib.co.kr': ['#articleBody'],
      'chosun.com': ['.article-body', 'section.article-body'],
      'hankyung.com': ['#articletxt', '.article-body'],
      'newsis.com': ['#articleBody'],
      'mk.co.kr': ['.art_txt', '#article_body'],
      'donga.com': ['.article_txt', '.article_view'],
    };
  }

  /**
   * 기사들을 배치로 나누어 병렬 스크래핑
   */
  private async scrapeBatched(
    articles: NewsArticle[],
    outputPath: string,
    selectorMap: Record<string, string[]>,
  ): Promise<ScrapeResult> {
    let successCount = 0;
    let failureCount = 0;
    for (let i = 0; i < articles.length; i += this.concurrencyLimit) {
      const chunk = articles.slice(i, i + this.concurrencyLimit);
      const results = await Promise.allSettled(
        chunk.map((article, idx) =>
          this.scrapeArticle({
            article,
            index: i + idx,
            total: articles.length,
            outputPath,
            selectorMap,
          }),
        ),
      );
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          successCount++;
        } else {
          failureCount++;
        }
      });
      await this.delay(500);
    }
    return { successCount, failureCount, outputPath };
  }

  /**
   * 단일 기사 스크래핑 및 저장
   */
  private async scrapeArticle(
    params: ScrapeArticleParams,
  ): Promise<ScrapedArticle> {
    const { article, index, total, outputPath, selectorMap } = params;
    try {
      const contentBody = await this.fetchArticleContent(
        article.link,
        selectorMap,
      );
      const result: ScrapedArticle = {
        ...article,
        contentBody: contentBody.replace(/\s\s+/g, '\n').trim(),
        crawledAt: new Date().toISOString(),
      };
      this.saveToFile(outputPath, result);
      const publishedCount = await this.messageQueue.publish([result]);
      if (publishedCount > 0) {
        this.logger.log(`[완료] ${index + 1}/${total} - 큐에 추가됨`);
      } else {
        this.logger.log(`[완료] ${index + 1}/${total} - 중복으로 큐에 추가 안됨`);
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[실패] ${index + 1}: ${article.title} - ${errorMessage}`);
      const errorResult: ScrapedArticle = {
        ...article,
        contentBody: `ERROR: ${errorMessage}`,
        crawledAt: new Date().toISOString(),
      };
      this.saveToFile(outputPath, errorResult);
      throw error;
    }
  }

  /**
   * 기사 URL에서 본문 내용 추출
   */
  private async fetchArticleContent(
    url: string,
    selectorMap: Record<string, string[]>,
  ): Promise<string> {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0...' },
      timeout: 5000,
    });
    const $ = cheerio.load(response.data);
    $('script, style, iframe, .ad, .copyright, .footer, button').remove();
    const domain = Object.keys(selectorMap).find((d) => url.includes(d));
    if (domain) {
      for (const selector of selectorMap[domain]) {
        const target = $(selector);
        if (target.length > 0) {
          return target.text().trim();
        }
      }
    }
    return $('article').text().trim();
  }

  /**
   * 결과를 파일에 저장
   */
  private saveToFile(outputPath: string, result: ScrapedArticle): void {
    fs.appendFileSync(
      outputPath,
      JSON.stringify(result) + '\n',
      'utf-8',
    );
  }

  /**
   * 지연 함수
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

