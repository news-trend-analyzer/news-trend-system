import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TrendKeywordQueryEntity } from './entities/trend-keyword-query.entity';

export type TrendKeywordQuerySnapshot = {
  keywordId: number;
  windowHours: number;
  periodStart: Date;
  periodEnd: Date;
  rank: number;
  sourceKeyword: string;
  title: string;
  searchQuery: string;
  intentSummary?: string | null;
  articleIds?: number[] | null;
  generatedAt: Date;
  expiresAt: Date;
};

@Injectable()
export class TrendKeywordQueryRepository {
  constructor(
    @InjectRepository(TrendKeywordQueryEntity)
    private readonly repository: Repository<TrendKeywordQueryEntity>,
  ) {}

  async findActiveByKeywordIds(
    keywordIds: number[],
    windowHours: number,
    now: Date = new Date(),
  ): Promise<Map<number, TrendKeywordQueryEntity>> {
    if (keywordIds.length === 0) {
      return new Map();
    }
    const rows = await this.repository.find({
      where: {
        keywordId: In(keywordIds),
        windowHours,
      },
      order: {
        periodEnd: 'DESC',
        generatedAt: 'DESC',
      },
    });
    const active = rows.filter(
      (row) => row.generatedAt <= now && row.expiresAt > now,
    );
    const map = new Map<number, TrendKeywordQueryEntity>();
    active.forEach((row) => {
      const keywordId = Number(row.keywordId);
      if (!map.has(keywordId)) {
        map.set(keywordId, row);
      }
    });
    return map;
  }

  async saveSnapshotRows(rows: TrendKeywordQuerySnapshot[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.repository.upsert(rows, [
      'keywordId',
      'windowHours',
      'periodStart',
    ]);
  }
}
