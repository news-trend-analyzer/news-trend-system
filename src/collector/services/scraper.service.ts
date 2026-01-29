import { Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { NewsArticle, ScrapedArticle } from '../models/article.model';
import { ScrapeResult, ScrapeArticleParams } from '../models/scraper.model';
import { MESSAGE_QUEUE, MessageQueue } from '../../common/message-queue/message-queue.interface';
import { ArticleRepository } from '../../common/database/article.repository';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly concurrencyLimit = 5;
  private readonly dbBatchSize = 50;

  constructor(
    @Inject(MESSAGE_QUEUE)
    private readonly messageQueue: MessageQueue<ScrapedArticle>,
    private readonly articleRepository: ArticleRepository,
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
      'chosun.com': [
        '#article-body',
        '.article-body',
        'section.article-body',
        '[data-module="ArticleBody"]',
        '.story-body',
        'article',
        '.article-content',
        '#article_content',
        "p.article-body__content",
        "section.article-body p",
        "div.article-body p",
        "div#article-body p",
        "article p",
      ],
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
    const scrapedArticles: ScrapedArticle[] = [];
    const dbBatch: Array<{
      publisher: string;
      url: string;
      title: string;
      bodyText: string;
      publishedAt: Date;
      collectedAt: Date;
      checksumHash: string | null;
    }> = [];
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
          const scraped = result.value;
          let publishedAt: Date;
          try {
            if (scraped.pubDate) {
              publishedAt = new Date(scraped.pubDate);
              if (isNaN(publishedAt.getTime())) {
                throw new Error('Invalid date');
              }
            } else {
              publishedAt = new Date(scraped.crawledAt);
            }
          } catch (error) {
            this.logger.warn(
              `pubDate 파싱 실패, collectedAt 사용: ${scraped.link}`,
            );
            publishedAt = new Date(scraped.crawledAt);
          }
          scrapedArticles.push(scraped);
          dbBatch.push({
            publisher: scraped.press,
            url: scraped.link,
            title: scraped.title,
            bodyText: scraped.contentBody,
            publishedAt,
            collectedAt: new Date(scraped.crawledAt),
            checksumHash: null,
          });
        } else {
          failureCount++;
        }
      });
      if (dbBatch.length >= this.dbBatchSize) {
        await this.flushDbBatchAndEnqueue(dbBatch, scrapedArticles);
        dbBatch.length = 0;
        scrapedArticles.length = 0;
      }
      await this.delay(500);
    }
    if (dbBatch.length > 0) {
      await this.flushDbBatchAndEnqueue(dbBatch, scrapedArticles);
    }
    return { successCount, failureCount, outputPath };
  }

  /**
   * DB 배치 저장 실행 및 MQ enqueue (articleId 포함)
   */
  private async flushDbBatchAndEnqueue(
    batch: Array<{
      publisher: string;
      url: string;
      title: string;
      bodyText: string;
      publishedAt: Date;
      collectedAt: Date;
      checksumHash: string | null;
    }>,
    scrapedArticles: ScrapedArticle[],
  ): Promise<void> {
    if (batch.length === 0) {
      return;
    }
    try {
      const savedArticles = await this.articleRepository.upsertArticlesBulk(batch);
      this.logger.log(`[DB 배치 저장] ${batch.length}건의 기사를 articles 테이블에 저장했습니다.`);
      const urlToArticleIdMap = new Map<string, number>();
      savedArticles.forEach((article) => {
        urlToArticleIdMap.set(article.url, article.id);
      });
      const articlesWithId = scrapedArticles.map((scraped) => {
        const articleId = urlToArticleIdMap.get(scraped.link);
        return {
          ...scraped,
          articleId,
        };
      });
      const publishedCount = await this.messageQueue.publish(articlesWithId);
      this.logger.log(
        `[MQ enqueue] ${publishedCount}건을 큐에 추가했습니다. (총 ${articlesWithId.length}건 중)`,
      );
    } catch (error) {
      this.logger.error(
        `[DB 배치 저장 실패] ${batch.length}건`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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
   * 단일 URL의 본문 추출 테스트 (테스트용)
   * @param url - 테스트할 기사 URL
   * @returns 추출된 본문 내용
   */
  async testFetchArticleContent(url: string): Promise<{
    url: string;
    content: string;
    contentLength: number;
    success: boolean;
    error?: string;
  }> {
    try {
      const selectorMap = this.getSelectorMap();
      const content = await this.fetchArticleContent(url, selectorMap);
      return {
        url,
        content,
        contentLength: content.length,
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        url,
        content: '',
        contentLength: 0,
        success: false,
        error: errorMessage,
      };
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
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      timeout: 10000,
    });
    const $ = cheerio.load(response.data);
    $('script, style, iframe, .ad, .copyright, .footer, button, nav, header, .header, .navigation, .sidebar, .comment, .comments').remove();
    const domain = Object.keys(selectorMap).find((d) => url.includes(d));
    if (domain) {
      for (const selector of selectorMap[domain]) {
        const target = $(selector);
        if (target.length > 0) {
          const content = target.text().trim();
          if (content.length > 50) {
            return content;
          }
          this.logger.warn(
            `[${domain}] 셀렉터 "${selector}"에서 본문이 너무 짧습니다 (${content.length}자): ${url}`,
          );
        }
      }
    }
    const fallbackSelectors = [
      'article',
      'main article',
      '#article-body',
      '.article-body',
      'section.article-body',
      '[data-module="ArticleBody"]',
      '.article-content',
      '#article-content',
      '.story-body',
      '.content',
      '#content',
      '[role="article"]',
      'main',
      '.post-content',
      '.entry-content',
      '.article-text',
      '.article_view',
      '.article_txt',
      "p.article-body__content",
      "section.article-body p",
      "div.article-body p",
      "div#article-body p",
      "article p",
    ];
    for (const selector of fallbackSelectors) {
      const target = $(selector);
      if (target.length > 0) {
        const content = target.text().trim();
        if (content.length > 50) {
          this.logger.debug(
            `폴백 셀렉터 "${selector}"로 본문 추출 성공: ${url}`,
          );
          return content;
        }
      }
    }
    const bodyText = $('body').text().trim();
    if (bodyText.length > 100) {
      this.logger.warn(
        `모든 셀렉터 실패, body 태그에서 추출 (${bodyText.length}자): ${url}`,
      );
      return bodyText;
    }
    this.logger.error(`본문 추출 실패: ${url}`);
    throw new Error(`본문을 추출할 수 없습니다: ${url}`);
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

