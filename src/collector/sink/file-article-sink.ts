import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ArticleSink } from './article-sink';
import { Article } from '../models/article.model';

@Injectable()
export class FileArticleSink implements ArticleSink {
  private readonly logger = new Logger(FileArticleSink.name);
  private readonly filePath: string;
  private dirReady = false;

  constructor(private readonly configService: ConfigService) {
    this.filePath =
      this.configService.get<string>('ARTICLE_SINK_PATH') ??
      path.join(process.cwd(), 'data', 'articles.jsonl');
  }

  /**
   * 기사 배열을 JSONL 형식으로 파일에 저장
   * @param items - 저장할 기사 배열
   */
  async save(items: Article[]): Promise<void> {
    if (!items.length) {
      return;
    }
    await this.ensureDir();
    const lines = items.map((item) => JSON.stringify(item)).join('\n') + '\n';
    await fs.appendFile(this.filePath, lines, 'utf8');
    this.logger.log(
      `파일에 ${items.length}건 저장: ${path.relative(process.cwd(), this.filePath)}`,
    );
  }

  /**
   * 저장 디렉토리가 없으면 생성
   */
  private async ensureDir(): Promise<void> {
    if (this.dirReady) {
      return;
    }
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    this.dirReady = true;
  }
}
