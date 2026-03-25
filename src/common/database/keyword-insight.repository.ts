import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KeywordInsightEntity } from './entities/keyword-insight.entity';

@Injectable()
export class KeywordInsightRepository {
  constructor(
    @InjectRepository(KeywordInsightEntity)
    private readonly repository: Repository<KeywordInsightEntity>,
  ) {}

  async save(params: {
    keywordId: number;
    analysisDate: string;
    summary: string;
    articleIds?: number[] | null;
    analyzedAt: Date;
  }): Promise<KeywordInsightEntity> {
    const entity = {
      keywordId: params.keywordId,
      analysisDate: params.analysisDate,
      summary: params.summary,
      articleIds: params.articleIds ?? null,
      analyzedAt: params.analyzedAt,
    } satisfies Partial<KeywordInsightEntity>;
    await this.repository.upsert(entity, ['keywordId', 'analysisDate']);
    return this.repository.findOneOrFail({
      where: {
        keywordId: params.keywordId,
        analysisDate: params.analysisDate,
      },
    });
  }

  /**
   * 키워드 ID로 최신 인사이트 단건 조회
   */
  async findByKeywordId(keywordId: number): Promise<KeywordInsightEntity | null> {
    return this.repository.findOne({
      where: { keywordId },
      order: { analysisDate: 'DESC' },
    });
  }

  /**
   * 지정한 analysis_date에 존재하는 키워드 ID 목록 조회
   */
  async findExistingKeywordIdsByDate(
    keywordIds: number[],
    analysisDate: string,
  ): Promise<Set<number>> {
    if (keywordIds.length === 0) {
      return new Set();
    }
    const rows = await this.repository
      .createQueryBuilder('ki')
      .select('ki.keyword_id', 'keyword_id')
      .where('ki.keyword_id IN (:...ids)', { ids: keywordIds })
      .andWhere('ki.analysis_date = :analysisDate', { analysisDate })
      .getRawMany<{ keyword_id: string | number }>();
    return new Set(rows.map((r) => Number(r.keyword_id)));
  }

  /**
   * 키워드 ID 목록에 해당하는 최신 인사이트 조회
   */
  async findByKeywordIds(keywordIds: number[]): Promise<Map<number, KeywordInsightEntity>> {
    if (keywordIds.length === 0) {
      return new Map();
    }
    const rows = await this.repository
      .createQueryBuilder('ki')
      .distinctOn(['ki.keyword_id'])
      .where('ki.keyword_id IN (:...ids)', { ids: keywordIds })
      .orderBy('ki.keyword_id', 'ASC')
      .addOrderBy('ki.analysis_date', 'DESC')
      .getMany();
    return new Map(rows.map((r) => [r.keywordId, r]));
  }
}
