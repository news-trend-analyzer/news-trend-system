import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis 기반 중복 체크 서비스
 * Link 기준으로 중복을 방지
 */
@Injectable()
export class RedisDedupeService {
  private readonly logger = new Logger(RedisDedupeService.name);
  private readonly redis: Redis;
  private readonly keyPrefix = 'seen:article:';

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
    });
  }

  /**
   * 기사 URL이 새로운 기사인지 확인
   * @param link - 확인할 기사 URL
   * @returns 새로운 기사면 true, 이미 본 기사면 false
   */
  async isNewArticle(link: string): Promise<boolean> {
    if (!link) {
      return false;
    }
    const key = `${this.keyPrefix}${link}`;
    const exists = await this.redis.exists(key);
    if (exists) {
      return false;
    }
    await this.redis.set(key, '1', 'EX', 86400 * 7); // 7일 TTL
    return true;
  }

  /**
   * 여러 기사 URL을 한 번에 체크하고 새로운 것만 반환
   * @param links - 확인할 기사 URL 배열
   * @returns 새로운 기사 URL 배열
   */
  async filterNewArticles(links: string[]): Promise<string[]> {
    if (!links.length) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    const keys = links.map((link) => `${this.keyPrefix}${link}`);
    keys.forEach((key) => {
      pipeline.exists(key);
    });
    const results = await pipeline.exec();
    const newLinks: string[] = [];
    const setPipeline = this.redis.pipeline();
    results?.forEach((result, index) => {
      if (result && result[1] === 0) {
        const link = links[index];
        newLinks.push(link);
        setPipeline.set(`${this.keyPrefix}${link}`, '1', 'EX', 86400 * 7);
      }
    });
    if (newLinks.length > 0) {
      await setPipeline.exec();
    }
    return newLinks;
  }

  /**
   * 중복 체크 저장소 초기화
   */
  async clear(): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    this.logger.log(`중복 체크 저장소 초기화: ${keys.length}개 키 삭제`);
  }

  /**
   * Redis 연결 종료
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}



