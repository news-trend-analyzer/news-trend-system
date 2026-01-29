import { Inject, Injectable, Logger } from '@nestjs/common';
import { RSS_SOURCES } from '../rss/rss-sources';
import { fetchRSS } from '../rss/rss-fetcher';
import { parseRSS } from '../rss/rss-parser';
import { ParsedRssItem, Article } from '../models/article.model';
import { CollectResult, HandleXmlResultParams } from '../models/collector.model';
import { isNewArticle } from '../utils/dedupe';
import { ARTICLE_SINK, ArticleSink } from '../sink/article-sink';

@Injectable()
export class CollectorService {
  private readonly logger = new Logger(CollectorService.name);

  constructor(
    @Inject(ARTICLE_SINK)
    private readonly articleSink: ArticleSink,
  ) {}

  /**
   * RSS 피드에서 기사를 수집하여 저장
   * @returns 수집 결과
   */
  async collect(): Promise<CollectResult> {
    const toSave: Article[] = [];
    const started = Date.now();
    await this.collectBatched(toSave);
    await this.articleSink.save(toSave);
    const took = Date.now() - started;
    this.logger.log(
      `✅ RSS 수집 완료 (${took}ms, collected=${toSave.length})`,
    );
    return { savedCount: toSave.length, took };
  }

  /**
   * 모든 언론사의 RSS 피드를 배치로 수집
   * @param toSave - 수집된 기사를 저장할 배열
   */
  private async collectBatched(toSave: Article[]): Promise<void> {
    for (const pressKey of Object.keys(RSS_SOURCES)) {
      const press = RSS_SOURCES[pressKey];
      await this.collectPressFeeds(pressKey, press, toSave);
    }
  }

  /**
   * 특정 언론사의 모든 카테고리 피드를 수집
   * @param pressKey - 언론사 키
   * @param press - 언론사 정보
   * @param toSave - 수집된 기사를 저장할 배열
   */
  private async collectPressFeeds(
    pressKey: string,
    press: typeof RSS_SOURCES[string],
    toSave: Article[],
  ): Promise<void> {
    const categories = Object.keys(press.feeds);
    const results = await Promise.allSettled(
      categories.map(async (category) => {
        const url = press.feeds[category];
        const xml = await fetchRSS(url);
        return { category, xml };
      }),
    );
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        this.handleXmlResult({
          pressName: press.name,
          category: result.value.category,
          xml: result.value.xml,
          toSave,
        });
      } else {
        this.logger.warn(`페치 실패 [${press.name}/${pressKey}]`, result.reason);
      }
    });
  }

  /**
   * XML 파싱 결과를 처리하여 새로운 기사만 저장 배열에 추가
   * @param params - XML 처리 파라미터
   */
  private handleXmlResult(params: HandleXmlResultParams): void {
    const { pressName, category, xml, toSave } = params;
    if (!xml) {
      return;
    }
    const items: ParsedRssItem[] = parseRSS(xml);
    items.forEach((item) => {
      if (isNewArticle(item.link)) {
        const article: Article = {
          ...item,
          press: pressName,
          category,
          collectedAt: new Date().toISOString(),
        };
        toSave.push(article);
      }
    });
  }
}
