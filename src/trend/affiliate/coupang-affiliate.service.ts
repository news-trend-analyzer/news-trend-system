import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
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

type CoupangProductSearchResponse = {
  rCode?: string;
  rMessage?: string;
  data?: {
    productData?: Array<{
      productId?: number;
      productName?: string;
      productPrice?: number;
      productImage?: string;
      productUrl?: string;
      categoryName?: string;
      keyword?: string;
      rank?: number;
      isRocket?: boolean;
      isFreeShipping?: boolean;
    }>;
  };
};

type CoupangProductCard = {
  productId: number | null;
  name: string;
  price: number | null;
  imageUrl: string;
  productUrl: string;
  categoryName: string | null;
  rank: number | null;
  isRocket: boolean;
  isFreeShipping: boolean;
};

@Injectable()
export class CoupangAffiliateService {
  private readonly domain: string;
  private readonly deeplinkPath =
    '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';
  private readonly productSearchPath =
    '/v2/providers/affiliate_open_api/apis/openapi/products/search';

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
    const { accessKey, secretKey } = this.getCredentials();

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

  async searchProducts(
    query: string,
    limit: number = 3,
  ): Promise<{
    query: string;
    products: CoupangProductCard[];
  }> {
    const { accessKey, secretKey } = this.getCredentials();
    const normalizedLimit = Math.min(Math.max(limit, 1), 10);
    const params = new URLSearchParams({
      keyword: query.trim(),
      limit: String(normalizedLimit),
    });
    const url = `${this.productSearchPath}?${params.toString()}`;
    const authorization = this.generateHmac('GET', url, secretKey, accessKey);
    const response = await axios.request<CoupangProductSearchResponse>({
      method: 'GET',
      baseURL: this.domain,
      url,
      headers: { Authorization: authorization },
      timeout: 5000,
    });
    const rawProducts = response.data.data?.productData ?? [];
    const products = rawProducts
      .map((product): CoupangProductCard | null => {
        if (!product.productName || !product.productImage || !product.productUrl) {
          return null;
        }
        return {
          productId: product.productId ?? null,
          name: product.productName,
          price:
            typeof product.productPrice === 'number'
              ? product.productPrice
              : null,
          imageUrl: product.productImage,
          productUrl: product.productUrl,
          categoryName: product.categoryName ?? null,
          rank: product.rank ?? null,
          isRocket: Boolean(product.isRocket),
          isFreeShipping: Boolean(product.isFreeShipping),
        };
      })
      .filter((product): product is CoupangProductCard => product !== null);

    if (products.length === 0 && response.data.rCode && response.data.rCode !== '0') {
      throw new BadGatewayException(
        response.data.rMessage || '쿠팡 상품 검색 API 응답이 올바르지 않습니다.',
      );
    }
    return {
      query,
      products,
    };
  }

  private buildSearchUrl(query: string): string {
    const params = new URLSearchParams({
      q: query.trim(),
      channel: 'user',
    });
    return `https://www.coupang.com/np/search?${params.toString()}`;
  }

  private getCredentials(): { accessKey: string; secretKey: string } {
    const accessKey = this.configService.get<string>('COUPANG_ACCESS_KEY');
    const secretKey = this.configService.get<string>('COUPANG_SECRET_KEY');
    if (!accessKey || !secretKey) {
      throw new ServiceUnavailableException('쿠팡 파트너스 API 키가 설정되지 않았습니다.');
    }
    return { accessKey, secretKey };
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
