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

  /**
   * 이미 인사이트가 있는 키워드 ID 목록 반환 (중복 제한용)
   */
  async findExistingKeywordIds(keywordIds: number[]): Promise<Set<number>> {
    if (keywordIds.length === 0) {
      return new Set();
    }
    const rows = await this.repository
      .createQueryBuilder('ki')
      .select('ki.keyword_id')
      .where('ki.keyword_id IN (:...ids)', { ids: keywordIds })
      .getRawMany();
    return new Set(rows.map((r) => Number(r.keyword_id)));
  }

  async save(params: {
    keywordId: number;
    summary: string;
    articleIds?: number[] | null;
    analyzedAt: Date;
  }): Promise<KeywordInsightEntity> {
    const entity = this.repository.create({
      keywordId: params.keywordId,
      summary: params.summary,
      articleIds: params.articleIds ?? null,
      analyzedAt: params.analyzedAt,
    });
    return this.repository.save(entity);
  }

  /**
   * 키워드 ID로 인사이트 단건 조회
   */
  async findByKeywordId(keywordId: number): Promise<KeywordInsightEntity | null> {
    return this.repository.findOne({ where: { keywordId } });
  }

  /**
   * 키워드 ID 목록에 해당하는 인사이트 조회 (랭킹 순 유지용 id 순서 전달)
   */
  async findByKeywordIds(keywordIds: number[]): Promise<Map<number, KeywordInsightEntity>> {
    if (keywordIds.length === 0) {
      return new Map();
    }
    const rows = await this.repository
      .createQueryBuilder('ki')
      .where('ki.keyword_id IN (:...ids)', { ids: keywordIds })
      .getMany();
    return new Map(rows.map((r) => [r.keywordId, r]));
  }
}
