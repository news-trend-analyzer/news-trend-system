import { Injectable } from '@nestjs/common';
import { KeywordRepository } from '../../common/database/keyword.repository';
import { ArticleRepository } from '../../common/database/article.repository';
import { GetRankingDto, GetTimeSeriesDto } from '../dto/report.dto';
import { TopKeyword } from '../../common/types/top-keyword.type';
import { TimeKeyword } from '../../common/types/time-keyword.type';
import { Article } from '../../common/types/article.type';
import { Keyword, SearchKeyword } from '../../common/types/keyword.type';
import { ArticleKeywordRepository } from '../../common/database/article-keyword.repository';

@Injectable()
export class DataReportService {
  constructor(
    private readonly keywordRepository: KeywordRepository,
    private readonly articleRepository: ArticleRepository,
    private readonly articleKeywordRepository: ArticleKeywordRepository,
  ) {}

  async getRanking(dto: GetRankingDto): Promise<TopKeyword[]> {
    const { recentBuckets, limit } = dto;

    return await this.keywordRepository.getRanking(recentBuckets, limit);
  }

  async getTimeSeries(dto: GetTimeSeriesDto): Promise<TimeKeyword[]> {
    const { keywordId, limit } = dto;

    return await this.keywordRepository.getTimeKeywordsByKeywordId(keywordId, limit);
  }

  async getCountKeywords(): Promise<number> {
    return await this.keywordRepository.getTotalKeywords();
  }

  async getCountArticles(): Promise<number> {
    return await this.articleRepository.getTotalArticles();
  }

  async getRelatedArticles(keywordId: number): Promise<Article[]> {
    return await this.articleKeywordRepository.getRelatedArticles(keywordId);
  }

  async getRelatedKeywords(keywordId: number): Promise<Keyword[]> {
    return await this.articleKeywordRepository.getRelatedKeywords(keywordId);
  }

  async searchKeyword(keyword: string, limit: number): Promise<SearchKeyword[]> {
    return await this.keywordRepository.searchKeyword(keyword, limit);
  }
}