import { Controller, Get, Query } from '@nestjs/common';
import { ArticleSearchService } from '../../common/elasticsearch/article-search.service';
import { SearchArticlesDto } from './dto/search-articles.dto';

/**
 * 기사 검색 API 컨트롤러
 * 공개 검색 API - Rate Limiting은 전역 ThrottlerGuard로 적용됨
 */
@Controller('articles')
export class ArticleSearchController {
  constructor(
    private readonly articleSearchService: ArticleSearchService,
  ) {}

  /**
   * Elasticsearch에 색인된 기사 검색
   * @param queryParams 검색 파라미터 (DTO로 자동 검증됨)
   * @returns 검색 결과
   */
  @Get('search')
  async searchArticles(@Query() queryParams: SearchArticlesDto) {
    const size = queryParams.size || 10;
    let from = 0;

    if (queryParams.page) {
      from = (queryParams.page - 1) * size;
    } else if (queryParams.from !== undefined) {
      from = queryParams.from;
    }

    return this.articleSearchService.searchArticles({
      query: queryParams.query,
      from,
      size,
    });
  }
}


