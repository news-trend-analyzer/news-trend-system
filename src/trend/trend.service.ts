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

/**
 * 트렌드 분석 서비스
 * MQ에서 스크래핑된 기사 데이터를 소비하여 트렌드 분석 수행
 */
@Injectable()
export class TrendAnalysisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrendAnalysisService.name);
  private worker: Worker | null = null;
  private readonly redis: Redis;
  private readonly STOP_WORDS = [
    '기자', '보도', '관련', '이번', '대한', '통해', '에서',
    '으로', '했다', '한다', '있는', '그리고', '하지만',
    '등', '있다', '연합뉴스', '뉴스', '사진', '제공',
    '가능성', '상황', '문제', '이슈', '내용', '기술', '오늘',
    '기업', '감독', '배우', '대표', '수사', '사업', '판매', '지원', '속보',
    '사진아이덴티티', '포토', '사설', 'AI', '2026' ,'대한민국', '퍼스트브랜드' , '포토+', '서울', '제주', '경찰'
  ];
  
  // Redis Keys
  private readonly TOP_KEYWORDS_KEY = 'trend:single:top';
  private readonly SNAPSHOT_KEY = 'trend:snapshot:last';
  private readonly KEYWORD_SCORE_PREFIX = 'trend:score:';
  private readonly KEYWORD_HOUR_PREFIX = 'trend:hour:';
  private readonly KEYWORD_ARTICLES_PREFIX = 'trend:articles:';
  private readonly KEYWORD_RELATION_PREFIX = 'trend:rel:';
  
  // 복합키 관련
  private readonly COMPOSITE_RANKING = 'trend:composite:ranking';
  private readonly COMPOSITE_ARTICLES = 'trend:composite:articles:';
  private readonly SINGLE_INDEX = 'trend:single:index:';
  private readonly SINGLE_PROCESSED = 'trend:single:processed:';
  private readonly ARTICLE_PROCESSED = 'trend:article:processed';
  
  private readonly TREND_WINDOW_HOURS = 24;
  private readonly TREND_WINDOW_SECONDS = 24 * 3600;
  private readonly MAX_ARTICLES_PER_KEYWORD = 100;

  constructor(
    @InjectQueue('articles') private readonly articlesQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
    });
    
    // Lua 스크립트 등록
    this.registerLuaScripts();
  }

  /**
   * Lua 스크립트 등록 (원자적 처리)
   */
  private registerLuaScripts() {
    // 중복 체크 및 점수 증가를 원자적으로 처리
    this.redis.defineCommand('addIfNotProcessed', {
      numberOfKeys: 2,
      lua: `
        local processedKey = KEYS[1]
        local targetKey = KEYS[2]
        local articleHash = ARGV[1]
        local score = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])
        
        -- SADD는 새로 추가되면 1, 이미 있으면 0 반환
        local added = redis.call('SADD', processedKey, articleHash)
        
        if added == 1 then
          redis.call('EXPIRE', processedKey, ttl)
          redis.call('ZINCRBY', targetKey, score, ARGV[4])
          return 1
        else
          return 0
        end
      `
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
    
    // 1시간마다 오래된 데이터 정리 (가벼운 버전)
    setInterval(() => {
      this.cleanupOldData().catch(err => 
        this.logger.error('데이터 정리 실패', err)
      );
    }, 60 * 60 * 1000);
  }

  /**
   * 모듈 종료 시 Worker 종료
   */
  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('트렌드 분석 Worker가 종료되었습니다.');
    }
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
      await this.aggregateKeywords(
        result.keywords,
        article.title,
        result.compositeKey,
        result.score,
        article.link,
      );
      this.logger.log(
        `트렌드 분석 완료: ${article.title} - 키워드 ${result.total}개 추출 및 집계 완료`,
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
   */
  private analyzeTrend(data: ScrapedArticle) {
    const { title, contentBody } = data;
    const newResult = this.analyzeTrendNew({
      title,
      content_body: contentBody,
    });
    const keywords = newResult.keywords.map((keyword, index) => ({
      keyword,
      score: newResult.score - index,
    }));
    return {
      title: newResult.title,
      keywords,
      total: keywords.length,
      compositeKey: newResult.compositeKey,
      score: newResult.score,
    };
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
   * 문자열 해시
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * 키워드 집계 (Lua 스크립트 활용한 원자적 처리)
   */
  private async aggregateKeywords(
    keywords: Array<{ keyword: string; score: number }>,
    articleTitle: string,
    compositeKey?: string,
    compositeScore?: number,
    articleLink?: string,
  ) {
    if (!compositeKey || !compositeScore || keywords.length < 2) return;

    const words = compositeKey.split(':');
    const now = Date.now();
    const currentHour = Math.floor(now / (1000 * 60 * 60));
    const articleHash = this.hashString(articleLink || articleTitle);

    // Lua 스크립트로 원자적 중복 체크 및 복합키 추가
    const compositeProcessedKey = this.ARTICLE_PROCESSED;
    const result: any = await (this.redis as any).addIfNotProcessed(
      compositeProcessedKey,
      this.COMPOSITE_RANKING,
      articleHash,
      compositeScore,
      this.TREND_WINDOW_SECONDS,
      compositeKey,
    );
    
    if (result === 0) {
      this.logger.log(`중복 기사 스킵: ${articleTitle}`);
      return;
    }

    // 단일 키워드별 Lua 스크립트 실행 (Promise.all로 제어)
    const luaPromises = words.map(word => {
      const singleProcessedKey = `${this.SINGLE_PROCESSED}${word}`;
      return (this.redis as any).addIfNotProcessed(
        singleProcessedKey,
        this.TOP_KEYWORDS_KEY,
        articleHash,
        compositeScore,
        this.TREND_WINDOW_SECONDS,
        word,
      );
    });

    const luaResults = await Promise.all(luaPromises);

    // 메인 pipeline에 모든 작업 포함
    const pipeline = this.redis.pipeline();

    // 복합키별 기사 목록 (LPUSH로 최신순, timestamp 포함)
    const articlesKey = `${this.COMPOSITE_ARTICLES}${compositeKey}`;
    const articleData = JSON.stringify({
      title: articleTitle,
      link: articleLink || '',
      timestamp: now,
    });
    pipeline.zadd(articlesKey, now, articleData); // Set 대신 Sorted Set 사용
    pipeline.zremrangebyrank(articlesKey, 0, -11); // 최신 10개만 유지
    pipeline.expire(articlesKey, this.TREND_WINDOW_SECONDS);

    // 단일 키워드 메타데이터 (Lua 결과에 따라)
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const added = luaResults[i];
      
      if (added === 1) {
        pipeline.incrby(`${this.KEYWORD_SCORE_PREFIX}${word}`, compositeScore);
        pipeline.expire(`${this.KEYWORD_SCORE_PREFIX}${word}`, this.TREND_WINDOW_SECONDS);
        
        const hourKey = `${this.KEYWORD_HOUR_PREFIX}${word}:${currentHour}`;
        pipeline.incrby(hourKey, compositeScore);
        pipeline.expire(hourKey, this.TREND_WINDOW_SECONDS);
      }

      // 기사 목록은 항상 업데이트 (added 조건과 무관)
      const singleArticlesKey = `${this.KEYWORD_ARTICLES_PREFIX}${word}`;
      pipeline.zadd(singleArticlesKey, now, articleTitle);
      pipeline.zremrangebyrank(singleArticlesKey, this.MAX_ARTICLES_PER_KEYWORD, -1);
      pipeline.expire(singleArticlesKey, this.TREND_WINDOW_SECONDS);

      // 인덱스 및 연관 단어
      const indexKey = `${this.SINGLE_INDEX}${word}`;
      pipeline.sadd(indexKey, compositeKey);
      pipeline.expire(indexKey, this.TREND_WINDOW_SECONDS);

      const partner = words.find(w => w !== word);
      if (partner) {
        pipeline.zincrby(`${this.KEYWORD_RELATION_PREFIX}${word}`, compositeScore, partner);
        pipeline.expire(`${this.KEYWORD_RELATION_PREFIX}${word}`, this.TREND_WINDOW_SECONDS);
      }
    }

    await pipeline.exec();
  }

  /**
   * 기사 샘플 제한 (비동기 처리)
   */
  private async limitArticleSamples(words: string[]): Promise<void> {
    // 이 메서드는 이제 사용하지 않음 (aggregateKeywords에서 ZREMRANGEBYRANK로 처리)
    return;
  }

  /**
   * 상위 트렌드 조회 (Pipeline으로 최적화)
   */
  async getTopTrends(limit: number = 10): Promise<any[]> {
    const now = Date.now();
    const currentHour = Math.floor(now / (1000 * 60 * 60));

    const topSingleKeywords = await this.redis.zrevrange(
      this.TOP_KEYWORDS_KEY,
      0,
      limit - 1,
      'WITHSCORES',
    );

    if (topSingleKeywords.length === 0) {
      return [];
    }

    const trends: any[] = [];
    const keywords: string[] = [];
    
    for (let i = 0; i < topSingleKeywords.length; i += 2) {
      keywords.push(topSingleKeywords[i]);
    }

    // Pipeline으로 모든 데이터 일괄 조회
    const pipeline = this.redis.pipeline();
    
    for (const keyword of keywords) {
      pipeline.zrevrank(this.SNAPSHOT_KEY, keyword);
      pipeline.zrevrange(`${this.KEYWORD_RELATION_PREFIX}${keyword}`, 0, 0);
      // ZREVRANGE로 최신 기사 조회 (timestamp 기준 역순)
      pipeline.zrevrange(`${this.KEYWORD_ARTICLES_PREFIX}${keyword}`, 0, 9);
      
      // 시간대별 점수 (최근 24시간)
      for (let hour = 0; hour < this.TREND_WINDOW_HOURS; hour++) {
        pipeline.get(`${this.KEYWORD_HOUR_PREFIX}${keyword}:${currentHour - hour}`);
      }
    }

    const results = await pipeline.exec();
    let resultIdx = 0;

    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];
      const totalScore = parseFloat(topSingleKeywords[i * 2 + 1]);
      const currentRank = i + 1;

      // 순위 변동
      const lastRank = results?.[resultIdx++]?.[1] as number | null;
      let status: 'up' | 'down' | 'same' | 'new' = 'new';
      let rankChange = 0;
      if (lastRank !== null) {
        const lastRankNum = lastRank + 1;
        rankChange = lastRankNum - currentRank;
        status = rankChange > 0 ? 'up' : (rankChange < 0 ? 'down' : 'same');
      }

      // 연관 단어
      const partners = results?.[resultIdx++]?.[1] as string[];
      const displayKeyword = partners?.length > 0 ? `${keyword}:${partners[0]}` : keyword;

      // 기사 목록 (최신순) - title 문자열 배열
      const articles = results?.[resultIdx++]?.[1] as string[];

      // 시간대별 점수 계산
      let recentScore = 0;
      for (let hour = 0; hour < this.TREND_WINDOW_HOURS; hour++) {
        const hScore = results?.[resultIdx++]?.[1] as string | null;
        if (hScore) recentScore += parseFloat(hScore);
      }

      trends.push({
        keyword: keyword,
        displayKeyword: displayKeyword,
        totalScore,
        recentScore,
        rank: currentRank,
        rankChange: Math.abs(rankChange),
        status,
        articles: articles || [],
      });
    }

    return trends;
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

  /**
   * 트렌드 랭킹 스냅샷 저장
   */
  async saveSnapshot(): Promise<void> {
    try {
      await this.redis.zunionstore(this.SNAPSHOT_KEY, 1, this.TOP_KEYWORDS_KEY);
      this.logger.log('3분 주기 랭킹 스냅샷 저장 완료');
    } catch (err) {
      this.logger.error(
        '스냅샷 저장 실패',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * 오래된 데이터 정리 (TTL 활용 + 경량 정리)
   * 개별 키는 TTL로 자동 삭제되므로, 랭킹 리스트만 정리
   */
  private async cleanupOldData(): Promise<void> {
    try {
      const now = Date.now();
      const cutoffScore = now - (this.TREND_WINDOW_HOURS * 3600 * 1000);
      
      // ZREMRANGEBYSCORE로 한 번에 오래된 항목 제거
      // 점수 기반이 아니라 시간 기반이므로, 최근 활동이 없는 하위 랭크 제거
      const totalCount = await this.redis.zcard(this.TOP_KEYWORDS_KEY);
      
      if (totalCount > 1000) {
        // 상위 1000개만 유지
        await this.redis.zremrangebyrank(this.TOP_KEYWORDS_KEY, 0, totalCount - 1001);
        this.logger.log(`랭킹 정리: ${totalCount - 1000}개 하위 키워드 제거`);
      }
      
      // 복합키 랭킹도 동일하게
      const compositeCount = await this.redis.zcard(this.COMPOSITE_RANKING);
      if (compositeCount > 1000) {
        await this.redis.zremrangebyrank(this.COMPOSITE_RANKING, 0, compositeCount - 1001);
        this.logger.log(`복합키 랭킹 정리: ${compositeCount - 1000}개 제거`);
      }
    } catch (err) {
      this.logger.error(
        '데이터 정리 실패',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}