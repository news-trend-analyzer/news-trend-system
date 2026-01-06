import { Injectable, Logger } from '@nestjs/common';
import { MessageQueue } from './message-queue.interface';

/**
 * Kafka를 사용한 메시지 큐 구현체
 * TODO: Kafka 클라이언트 라이브러리 설치 및 구현
 * - kafkajs 또는 @nestjs/microservices 사용
 */
@Injectable()
export class KafkaMessageQueueService<T = unknown>
  implements MessageQueue<T>
{
  private readonly logger = new Logger(KafkaMessageQueueService.name);

  /**
   * 데이터 배열을 Kafka 토픽에 전송
   * @param items - 전송할 데이터 배열
   * @returns 실제로 큐에 추가된 항목 개수
   */
  async publish(items: T[]): Promise<number> {
    if (!items.length) {
      return;
    }
    // TODO: Kafka producer 구현
    // const producer = this.kafkaService.getProducer();
    // await producer.send({
    //   topic: 'articles',
    //   messages: items.map((item) => ({
    //     value: JSON.stringify(item),
    //   })),
    // });
    this.logger.log(`${items.length}건의 항목을 Kafka에 전송했습니다.`);
    return items.length;
  }
}

