import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Admin 엔드포인트 보호를 위한 Guard
 * - API Key 검증
 * - IP 화이트리스트 검증
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string;
    const adminApiKey = this.configService.get<string>('ADMIN_API_KEY');
    const clientIp = this.getClientIp(request);
    const allowedIps = this.configService
      .get<string>('ALLOWED_ADMIN_IPS', '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);

    // 개발 환경에서는 ALLOWED_ADMIN_IPS가 비어있으면 통과
    const isDevelopment =
      this.configService.get<string>('NODE_ENV', 'development') ===
      'development';

    // API Key 검증
    if (adminApiKey) {
      if (!apiKey || apiKey !== adminApiKey) {
        this.logger.warn(
          `Unauthorized access attempt from IP: ${clientIp} - Invalid API Key`,
        );
        throw new ForbiddenException('Invalid API Key');
      }
    }

    // IP 화이트리스트 검증 (설정된 경우)
    if (allowedIps.length > 0) {
      if (!allowedIps.includes(clientIp)) {
        this.logger.warn(
          `Unauthorized access attempt from IP: ${clientIp} - Not in whitelist`,
        );
        throw new ForbiddenException('Access denied from this IP');
      }
    } else if (!isDevelopment && !adminApiKey) {
      // 프로덕션 환경에서 API Key와 IP 둘 다 없으면 차단
      this.logger.warn(
        `Unauthorized access attempt from IP: ${clientIp} - No security configured`,
      );
      throw new ForbiddenException(
        'Admin access requires API Key or IP whitelist configuration',
      );
    }

    this.logger.debug(`Admin access granted to IP: ${clientIp}`);
    return true;
  }

  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    const realIp = request.headers['x-real-ip'] as string;
    if (realIp) {
      return realIp;
    }
    return request.ip || request.connection.remoteAddress || 'unknown';
  }
}


