import { Controller, Get } from '@nestjs/common';

/**
 * Health check 컨트롤러
 * Docker healthcheck를 위한 엔드포인트 제공
 */
@Controller()
export class HealthController {
  /**
   * Health check 엔드포인트
   * @returns 서비스 상태
   */
  @Get('health')
  getHealth() {
    return { status: 'ok', service: 'collector' };
  }
}

