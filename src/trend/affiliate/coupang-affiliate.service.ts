import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHmac } from 'crypto';

type CoupangDeeplinkResponse = {
  rCode?: string;
  rMessage?: string;
  data?: Array<{
    originalUrl: string;
    shortenUrl: string;
  }>;
};

@Injectable()
export class CoupangAffiliateService {
  private readonly domain: string;
  private readonly deeplinkPath =
    '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';

  constructor(private readonly configService: ConfigService) {
    this.domain = this.configService.get<string>(
      'COUPANG_PARTNERS_DOMAIN',
      'https://api-gateway.coupang.com',
    );
  }

  async createDeeplink(query: string): Promise<{
    query: string;
    originalUrl: string;
    shortenUrl: string;
  }> {
    const accessKey = this.configService.get<string>('COUPANG_ACCESS_KEY');
    const secretKey = this.configService.get<string>('COUPANG_SECRET_KEY');
    if (!accessKey || !secretKey) {
      throw new ServiceUnavailableException('쿠팡 파트너스 API 키가 설정되지 않았습니다.');
    }

    const originalUrl = this.buildSearchUrl(query);
    const authorization = this.generateHmac('POST', this.deeplinkPath, secretKey, accessKey);
    const response = await axios.request<CoupangDeeplinkResponse>({
      method: 'POST',
      baseURL: this.domain,
      url: this.deeplinkPath,
      headers: { Authorization: authorization },
      data: { coupangUrls: [originalUrl] },
      timeout: 5000,
    });
    const item = response.data.data?.[0];
    return {
      query,
      originalUrl,
      shortenUrl: item?.shortenUrl ?? originalUrl,
    };
  }

  private buildSearchUrl(query: string): string {
    const params = new URLSearchParams({
      q: query.trim(),
      channel: 'user',
    });
    return `https://www.coupang.com/np/search?${params.toString()}`;
  }

  private generateHmac(
    method: string,
    url: string,
    secretKey: string,
    accessKey: string,
  ): string {
    const [path, query = ''] = url.split(/\?/);
    const datetime = this.formatUtcDate(new Date());
    const message = datetime + method + path + query;
    const signature = createHmac('sha256', secretKey).update(message).digest('hex');
    return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
  }

  private formatUtcDate(date: Date): string {
    const year = String(date.getUTCFullYear()).slice(-2);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const second = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hour}${minute}${second}Z`;
  }
}
