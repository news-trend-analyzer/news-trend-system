import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { ScrapedArticle } from '../collector/models/article.model';
import { KeywordRepository } from '../common/database/keyword.repository';

type KeywordScore = Readonly<{ keyword: string; score: number }>;

type PendingKeywordSave = Readonly<{
  articleId: number;
  keywords: ReadonlyArray<KeywordScore>;
}>;

/**
 * 트렌드 분석 서비스
 * MQ에서 스크래핑된 기사 데이터를 소비하여 트렌드 분석 수행 및 DB 저장
 * - Single keywords와 Composite keywords를 PostgreSQL에 저장
 * - Redis는 MQ(BullMQ) 및 캐싱 용도로만 사용
 */
@Injectable()
export class TrendAnalysisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrendAnalysisService.name);
  private worker: Worker | null = null;
  private readonly redis: Redis;
  private readonly keywordSaveBatchSize = 50;
  private readonly pendingKeywordSaves: PendingKeywordSave[] = [];
  private isFlushingKeywordSaves = false;
  private keywordFlushIntervalId: NodeJS.Timeout | null = null;
  /** Composite 키워드 boost를 줄일 카테고리 (예: 연예·스포츠 등) */
  private readonly COMPOSITE_BOOST_REDUCED_CATEGORIES = new Set([
    'entertainment',
    'entertainments',
    'culture',
    'culture-life',
    'sports',
  ]);

  private readonly STOP_WORDS = [
    '기자', '보도', '관련', '이번', '대한', '통해', '에서',
    '으로', '했다', '한다', '있는', '그리고', '하지만',
    '등', '있다', '연합뉴스', '뉴스', '사진', '제공',
    '가능성', '상황', '문제', '이슈', '내용', '기술', '오늘',
    '기업', '감독', '배우', '대표', '수사', '사업', '판매', '지원', '속보',
    '사진아이덴티티', '포토', '사설', 'AI', '2026' ,'대한민국', '퍼스트브랜드', 
    '포토+', '서울', '제주', '경찰', '인사', '한국', '올해', '시장', '사용',
    '통합', '지난해', '대전','대구','강원','부산','진주', 'MK포토', '경기', 
    '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월',
    '울산', '전국','이시각헤드라인', '날씨','신문', '주요', '역투하'
  ];
  
  // Redis 캐시 키
  private readonly CACHE_TOP_TRENDS_KEY = 'trend:cache:top:24h';
  /** API 응답 캐시 TTL. 프론트 요청 시 이 간격마다 최신화 */
  private readonly CACHE_TTL_SECONDS = 30;
  private readonly LAST_TOP_TRENDS_KEY = 'trend:top:last';
  private readonly LAST_TOP_TRENDS_UPDATED_KEY = 'trend:top:last:updated';
  /** 이전 계산 결과. 스냅샷 갱신 시 current 대신 previous를 저장해 "시간 차 기반 등락" 명확화 */
  private readonly PREVIOUS_RESULT_KEY = 'trend:top:previous';
  /** 스냅샷 갱신 간격 (초). 등락 비교 기준점으로 이 간격마다만 갱신 */
  private readonly SNAPSHOT_INTERVAL_SECONDS = 600;
  /** 등락 비교용 후보 개수. top N보다 넓게 저장해 15위→9위 같은 상승을 new로 오판하지 않음 */
  private readonly SNAPSHOT_CANDIDATE_LIMIT = 20;
  
  // Redis Keys (getKeywordTrend에서 사용 중 - 향후 DB 기반으로 재구현 필요)
  private readonly KEYWORD_SCORE_PREFIX = 'trend:score:';
  private readonly KEYWORD_HOUR_PREFIX = 'trend:hour:';
  private readonly KEYWORD_ARTICLES_PREFIX = 'trend:articles:';
  private readonly KEYWORD_RELATION_PREFIX = 'trend:rel:';
  private readonly COMPOSITE_RANKING = 'trend:composite:ranking';
  private readonly COMPOSITE_ARTICLES = 'trend:composite:articles:';
  private readonly SINGLE_INDEX = 'trend:single:index:';
  private readonly TREND_WINDOW_HOURS = 24;

  constructor(
    @InjectQueue('articles') private readonly articlesQueue: Queue,
    private readonly configService: ConfigService,
    private readonly keywordRepository: KeywordRepository,
  ) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
    });
  }

  /**
   * 모듈 초기화 시 Worker 시작
   */
  onModuleInit() {
    const connection = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
    };
    this.worker = new Worker<ScrapedArticle>(
      'articles',
      async (job: Job<ScrapedArticle>) => {
        return this.processArticle(job);
      },
      {
        connection,
        concurrency: 5,
      },
    );
    this.worker.on('completed', (job) => {
      this.logger.log(`작업 완료: ${job.id}`);
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`작업 실패: ${job?.id}`, err.stack);
    });
    this.logger.log('트렌드 분석 Worker가 시작되었습니다.');

    // 30초마다 남은 키워드 배치 flush (트래픽이 적어도 DB 누적 저장되도록)
    this.keywordFlushIntervalId = setInterval(() => {
      this.flushKeywordSaves().catch((err) =>
        this.logger.error('키워드 배치 flush 실패', err),
      );
    }, 30 * 1000);
  }

  /**
   * 모듈 종료 시 Worker 종료
   */
  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('트렌드 분석 Worker가 종료되었습니다.');
    }
    if (this.keywordFlushIntervalId) {
      clearInterval(this.keywordFlushIntervalId);
      this.keywordFlushIntervalId = null;
    }
    await this.flushKeywordSaves();
    await this.redis.quit();
  }

  /**
   * MQ에서 스크래핑된 기사 데이터를 처리하여 트렌드 분석 수행
   */
  private async processArticle(job: Job<ScrapedArticle>) {
    const article = job.data;
    this.logger.log(`트렌드 분석 시작: ${article.title} (${article.link})`);
    try {
      const result = this.analyzeTrend(article);
      // DB 저장만 수행 (Redis 집계 로직 제거)
      if (article.articleId && result.keywords.length >= 2) {
        await this.enqueueKeywordSave({
          articleId: article.articleId,
          keywords: result.keywords,
        });
      }
      this.logger.log(
        `트렌드 분석 완료: ${article.title} - 키워드 ${result.total}개 추출 완료`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `트렌드 분석 실패: ${article.link}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * 기사 데이터를 분석하여 트렌드 키워드 추출
   * 카테고리에 따라 Composite 키워드 boost를 조정 (연예·스포츠 등은 boost 감소)
   */
  private analyzeTrend(data: ScrapedArticle) {
    const { title, contentBody, category } = data;
    const newResult = this.analyzeTrendNew({
      title,
      content_body: contentBody,
    });
    // Single keywords (기존 로직)
    const singleKeywords = newResult.keywords.map((keyword, index) => ({
      keyword,
      score: newResult.score - index,
    }));
    // Composite keyword 추가 (카테고리별 boost 적용)
    const allKeywords = [...singleKeywords];
    if (newResult.compositeKey && newResult.compositeKey.length > 0) {
      const compositeBoost = this.getCompositeBoost(category);
      allKeywords.push({
        keyword: newResult.compositeKey,
        score: newResult.score + compositeBoost,
      });
    }
    return {
      title: newResult.title,
      keywords: allKeywords,
      total: allKeywords.length,
      compositeKey: newResult.compositeKey,
      score: newResult.score,
    };
  }

  /**
   * 카테고리별 Composite 키워드 boost 반환
   * @param category - 기사 카테고리 (예: politics, entertainment, sports)
   * @returns boost 점수 (기본 5, 감소 카테고리는 2)
   */
  private getCompositeBoost(category?: string): number {
    const defaultBoost = 10;
    const reducedBoost = 5;
    if (!category) {
      return defaultBoost;
    }
    const normalized = category.toLowerCase().trim();
    return this.COMPOSITE_BOOST_REDUCED_CATEGORIES.has(normalized)
      ? reducedBoost
      : defaultBoost;
  }

  /**
   * 새로운 트렌드 분석 로직
   */
  private analyzeTrendNew(data: {
    title: string;
    content_body: string;
  }) {
    const { title, content_body } = data;
    const compositeKey = this.createCompositeKey(title, content_body);
    const score = this.calculateScore(title, content_body);
    return {
      title,
      compositeKey,
      score,
      keywords: this.extractTop2Keywords(title, content_body),
    };
  }

  /**
   * 조사 제거
   */
  private removeParticles(text: string): string {
    return text.replace(/(은|는|이|가|을|를|의|에|로|와|과|도)(?=\s|$)/g, '');
  }

  /**
   * 토큰화 및 전처리
   */
  private tokenize(text: string): string[] {
    const tokens = text
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const cleanedTokens = tokens
      .map((t) => this.removeSpecialChars(t))
      .map((t) => this.removeParticles(t))
      .filter(
        (t) => t.length > 1 && !this.STOP_WORDS.includes(t),
      );
    return cleanedTokens;
  }

  /**
   * 특수문자 제거
   */
  private removeSpecialChars(text: string): string {
    return text
      .replace(/["'`""''「」『』《》〈〉【】〔〕]/g, '')
      .replace(/[,\.;:!?\-_=+\[\]{}()]/g, '')
      .trim();
  }

  /**
   * 본문에서 키워드 등장 횟수 계산
   */
  private countInBody(keyword: string, bodyTokens: string[]): number {
    return bodyTokens.filter(
      (t) => t.includes(keyword) || keyword.includes(t),
    ).length;
  }

  /**
   * 제목에서 핵심 키워드 2개 추출
   */
  private extractTop2Keywords(
    title: string,
    contentBody: string,
  ): string[] {
    const titleTokens = this.tokenize(title);
    const bodyTokens = this.tokenize(contentBody);
    if (titleTokens.length === 0) {
      return [];
    }
    const keywordScores = titleTokens.map((keyword, idx) => ({
      keyword,
      count: this.countInBody(keyword, bodyTokens),
      position: idx,
    }));
    keywordScores.sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.position - b.position;
    });
    const top2 = keywordScores.slice(0, 2).map((item) => item.keyword);
    return top2;
  }

  /**
   * 복합키 생성
   */
  private createCompositeKey(title: string, contentBody: string): string {
    const keywords = this.extractTop2Keywords(title, contentBody);
    if (keywords.length === 0) {
      return '';
    }
    const sorted = [...keywords].sort();
    return sorted.join(':');
  }

  /**
   * 점수 계산
   */
  private calculateScore(title: string, contentBody: string): number {
    const keywords = this.extractTop2Keywords(title, contentBody);
    const bodyTokens = this.tokenize(contentBody);
    
    const baseScore = 10;
    const frequencyScore = keywords.reduce(
      (sum, kw) => sum + this.countInBody(kw, bodyTokens),
      0,
    );
    
    return baseScore + Math.min(frequencyScore, 5);
  }


  /**
   * 키워드 저장 배치를 큐에 추가하고 필요 시 flush
   */
  private async enqueueKeywordSave(params: {
    articleId?: number;
    keywords: ReadonlyArray<KeywordScore>;
  }): Promise<void> {
    if (!params.articleId) {
      return;
    }
    if (params.keywords.length < 2) {
      return;
    }
    this.pendingKeywordSaves.push({
      articleId: params.articleId,
      keywords: params.keywords,
    });
    if (this.pendingKeywordSaves.length >= this.keywordSaveBatchSize) {
      await this.flushKeywordSaves();
    }
  }

  /**
   * 누적 저장용 bucket time 계산
   */
  private createBucketTime(date: Date): Date {
    const bucketMinutes = this.configService.get<number>('BUCKET_MINUTES', 5);
    const minutes = date.getUTCMinutes();
    const floored = minutes - (minutes % bucketMinutes);
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        floored,
        0,
        0,
      ),
    );
  }

  /**
   * pendingKeywordSaves를 DB로 배치 저장
   */
  private async flushKeywordSaves(): Promise<void> {
    if (this.isFlushingKeywordSaves) {
      return;
    }
    if (this.pendingKeywordSaves.length === 0) {
      return;
    }
    this.isFlushingKeywordSaves = true;
    const batch = this.pendingKeywordSaves.splice(0, this.keywordSaveBatchSize);
    try {
      await this.keywordRepository.saveKeywordsWithRelationsBatch({
        articles: batch.map((item) => ({
          articleId: item.articleId,
          keywords: item.keywords as Array<{ keyword: string; score: number }>,
        })),
        bucketTime: this.createBucketTime(new Date()),
      });
    } catch (error) {
      this.logger.error(
        `키워드 배치 저장 실패: ${batch.length}건`,
        error instanceof Error ? error.stack : String(error),
      );
      this.pendingKeywordSaves.unshift(...batch);
    } finally {
      this.isFlushingKeywordSaves = false;
    }
  }


  /**
   * 상위 트렌드 조회 (DB 기반, 24시간 기준)
   * Composite 키워드를 점수 순으로 조회하여 그대로 반환
   */
  async getTopTrends(limit: number = 10): Promise<any[]> {
    // 1) 캐시된 랭킹이 있으면 그대로 반환 (등락 정보 포함)
    const cacheKey = this.CACHE_TOP_TRENDS_KEY;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return parsed.slice(0, limit);
    }

    // 2) 이전 랭킹 스냅샷 로드 (등락 계산용)
    const lastSnapshotJson = await this.redis.get(this.LAST_TOP_TRENDS_KEY);
    const prevRankMap = new Map<number, number>();
    if (lastSnapshotJson) {
      try {
        const lastSnapshot = JSON.parse(lastSnapshotJson) as Array<{ id: number | string; rank: number }>;
        lastSnapshot.forEach((item) => {
          const id = Number(item.id);
          const rank = Number(item.rank);
          if (!Number.isNaN(id) && !Number.isNaN(rank)) {
            prevRankMap.set(id, rank);
          }
        });
      } catch (err) {
        this.logger.error(
          '이전 랭킹 스냅샷 파싱 실패',
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    // 3) DB에서 Composite 키워드 조회 (top N보다 넓게 조회해 등락 비교 정확도 향상)
    const candidates = await this.keywordRepository.findTopKeywords24h(
      this.SNAPSHOT_CANDIDATE_LIMIT,
    );

    // 4) 결과 포맷팅 + 등락 계산
    const trends = candidates.map((k, idx) => {
      const currentRank = idx + 1;
      const keywordId = Number(k.id);
      const prevRank = prevRankMap.get(keywordId) ?? null;

      let status: 'up' | 'down' | 'same' | 'new' = 'new';
      let rankChange = 0;

      if (prevRank !== null) {
        rankChange = prevRank - currentRank; // +면 상승, -면 하강
        if (rankChange > 0) {
          status = 'up';
        } else if (rankChange < 0) {
          status = 'down';
        } else {
          status = 'same';
        }
      }

      return {
        id: keywordId,
        rank: currentRank,
        keyword: k.normalizedText,
        type: k.type,
        status,
        rankChange: Math.abs(rankChange),
        score: k.finalScore,
        score24h: k.score24h,
        scoreRecent: k.scoreRecent,
        scorePrev: k.scorePrev,
        diffScore: k.diffScore,
      };
    });

    const trendsJson = JSON.stringify(trends);

    // 5) 캐시 저장 (항상)
    await this.redis.setex(cacheKey, this.CACHE_TTL_SECONDS, trendsJson);

    // 6) 스냅샷 갱신: current가 아닌 previous를 저장해 "이전 시점 기준" 등락 비교
    const nowSec = Math.floor(Date.now() / 1000);
    const lastUpdated = await this.redis.get(this.LAST_TOP_TRENDS_UPDATED_KEY);
    const shouldUpdateSnapshot =
      !lastUpdated ||
      nowSec - Number.parseInt(lastUpdated, 10) >= this.SNAPSHOT_INTERVAL_SECONDS;
    const previousResultJson = await this.redis.get(this.PREVIOUS_RESULT_KEY);
    if (shouldUpdateSnapshot) {
      const snapshotValue = previousResultJson ?? trendsJson;
      await Promise.all([
        this.redis.set(this.LAST_TOP_TRENDS_KEY, snapshotValue),
        this.redis.set(this.LAST_TOP_TRENDS_UPDATED_KEY, nowSec.toString()),
        this.redis.set(this.PREVIOUS_RESULT_KEY, trendsJson),
      ]);
    } else {
      await this.redis.set(this.PREVIOUS_RESULT_KEY, trendsJson);
    }

    return trends.slice(0, limit);
  }

  /**
   * 트렌드 점수 계산
   */
  private calculateTrendScore(totalScore: number, recentScore: number): number {
    if (totalScore === 0) return 0;
    const recentRatio = recentScore / totalScore;
    const baseScore = Math.log10(totalScore + 1) * 10;
    const trendBoost = recentRatio * 50;
    return baseScore + trendBoost;
  }

  /**
   * 특정 키워드의 트렌드 정보 조회 (Pipeline 최적화)
   * @deprecated Redis 기반 로직입니다. 향후 DB 기반으로 재구현 필요합니다.
   */
  async getKeywordTrend(keyword: string): Promise<any> {
    const now = Date.now();
    const currentHour = Math.floor(now / (1000 * 60 * 60));

    // Pipeline으로 일괄 조회
    const pipeline = this.redis.pipeline();
    
    pipeline.get(`${this.KEYWORD_SCORE_PREFIX}${keyword}`);
    // ZREVRANGE로 최신 기사 조회
    pipeline.zrevrange(`${this.KEYWORD_ARTICLES_PREFIX}${keyword}`, 0, -1);
    pipeline.smembers(`${this.SINGLE_INDEX}${keyword}`);
    
    for (let hour = 0; hour < this.TREND_WINDOW_HOURS; hour++) {
      pipeline.get(`${this.KEYWORD_HOUR_PREFIX}${keyword}:${currentHour - hour}`);
    }

    const results = await pipeline.exec();
    let idx = 0;

    const totalScoreStr = results?.[idx++]?.[1] as string | null;
    const totalScore = totalScoreStr ? parseFloat(totalScoreStr) : 0;
    const articles = results?.[idx++]?.[1] as string[];
    const compositeKeys = results?.[idx++]?.[1] as string[];

    // 시간대별 점수
    let recentScore = 0;
    const hourlyBreakdown: any[] = [];
    for (let hour = 0; hour < this.TREND_WINDOW_HOURS; hour++) {
      const hourScoreStr = results?.[idx++]?.[1] as string | null;
      const hourScore = hourScoreStr ? parseFloat(hourScoreStr) : 0;
      if (hourScore > 0) {
        recentScore += hourScore;
        hourlyBreakdown.push({ hour: currentHour - hour, score: hourScore });
      }
    }

    const trendScore = this.calculateTrendScore(totalScore, recentScore);

    // 복합키 상세 (Pipeline으로 일괄 조회)
    const compositeDetails: any[] = [];
    if (compositeKeys && compositeKeys.length > 0) {
      const ckPipeline = this.redis.pipeline();
      for (const ck of compositeKeys) {
        ckPipeline.zscore(this.COMPOSITE_RANKING, ck);
        // ZREVRANGE로 최신 기사 조회
        ckPipeline.zrevrange(`${this.COMPOSITE_ARTICLES}${ck}`, 0, 2);
      }
      
      const ckResults = await ckPipeline.exec();
      let ckIdx = 0;
      
      for (const ck of compositeKeys) {
        const ckScore = ckResults?.[ckIdx++]?.[1] as string | null;
        const ckArticlesJson = ckResults?.[ckIdx++]?.[1] as string[];
        
        if (ckScore) {
          compositeDetails.push({
            compositeKey: ck,
            keywords: ck.split(':'),
            score: parseFloat(ckScore),
            articleCount: Math.round(parseFloat(ckScore) / 10),
            sampleArticles: ckArticlesJson ? ckArticlesJson.map(json => JSON.parse(json)) : [],
          });
        }
      }
      
      compositeDetails.sort((a, b) => b.score - a.score);
    }

    return {
      keyword,
      totalScore,
      recentScore,
      trendScore,
      articles: articles || [],
      hourlyBreakdown: hourlyBreakdown.sort((a, b) => b.hour - a.hour),
      relatedTopics: compositeDetails.slice(0, 5),
    };
  }

}