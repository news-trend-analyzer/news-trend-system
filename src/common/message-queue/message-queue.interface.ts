/**
 * 메시지 큐 인터페이스
 * BullMQ, Kafka 등 다양한 메시지 큐 구현체가 이 인터페이스를 구현
 */
export interface MessageQueue<T = unknown> {
  /**
   * 데이터 배열을 큐에 전송
   * @param items - 전송할 데이터 배열
   * @returns 실제로 큐에 추가된 항목 개수
   */
  publish(items: T[]): Promise<number>;
}

/**
 * NestJS 의존성 주입 토큰
 * 메시지 큐 구현체 교체 시 이 토큰으로 다른 구현을 주입할 수 있음
 */
export const MESSAGE_QUEUE = 'MESSAGE_QUEUE';

