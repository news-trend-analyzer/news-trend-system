import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { MessageQueue } from './message-queue.interface';
import { RedisDedupeService } from './redis-dedupe.service';

/**
 * Link를 가진 항목 인터페이스
 */
interface ItemWithLink {
  link: string;
}

/**
 * BullMQ를 사용한 메시지 큐 구현체
 * Link 기준으로 중복 방지
 */
@Injectable()
export class BullMQMessageQueueService<T extends ItemWithLink = ItemWithLink>
  implements MessageQueue<T>
{
  private readonly logger = new Logger(BullMQMessageQueueService.name);

  constructor(
    @InjectQueue('articles') private readonly articlesQueue: Queue<T>,
    private readonly dedupeService: RedisDedupeService,
  ) {}

  /**
   * 데이터 배열을 BullMQ 큐에 전송
   * Link 기준으로 중복 체크 후 새로운 항목만 큐에 추가
   * @param items - 전송할 데이터 배열
   * @returns 실제로 큐에 추가된 항목 개수
   */
  async publish(items: T[]): Promise<number> {
    if (!items.length) {
      return 0;
    }
    const links = items.map((item) => item.link);
    const newLinks = await this.dedupeService.filterNewArticles(links);
    const newItems = items.filter((item) => newLinks.includes(item.link));
    if (!newItems.length) {
      this.logger.log(`모든 항목이 중복입니다. (총 ${items.length}건)`);
      return 0;
    }
    const jobs = newItems.map((item) => {
      const jobId = this.generateJobId(item.link);
      return {
        name: 'process-item' as const,
        data: item,
        opts: {
          jobId,
          removeOnComplete: true,
          removeOnFail: false,
        },
      };
    });
    await this.articlesQueue.addBulk(jobs as any);
    this.logger.log(
      `${newItems.length}건의 새로운 항목을 큐에 추가했습니다. (중복 제외: ${items.length - newItems.length}건)`,
    );
    return newItems.length;
  }

  /**
   * Link 기반으로 Job ID 생성
   * 같은 Link는 같은 Job ID를 가지므로 BullMQ가 자동으로 중복 방지
   */
  private generateJobId(link: string): string {
    return createHash('md5').update(link).digest('hex');
  }
}

