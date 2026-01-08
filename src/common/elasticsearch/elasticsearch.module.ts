import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchModule as NestElasticsearchModule } from '@nestjs/elasticsearch';
import { ArticleSearchService } from './article-search.service';

/**
 * Elasticsearch 연동 모듈
 * - 전역 ConfigModule과 연동하여 연결 정보를 구성
 * - 기사 색인을 담당하는 ArticleSearchService를 제공
 */
@Module({
  imports: [
    ConfigModule,
    NestElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Docker Compose 환경에서는 'http://elasticsearch:9200' 사용
        // 로컬 개발 환경에서는 'http://localhost:9200' 사용
        const node = configService.get<string>(
          'ELASTICSEARCH_NODE',
          'http://localhost:9200',
        );
        const username = configService.get<string>('ELASTICSEARCH_USERNAME', '');
        const password = configService.get<string>('ELASTICSEARCH_PASSWORD', '');
        const hasAuth = Boolean(username);
        const baseConfig = {
          node,
          maxRetries: 3,
          requestTimeout: 30000,
        };
        if (!hasAuth) {
          return baseConfig;
        }
        return {
          ...baseConfig,
          auth: {
            username,
            password,
          },
        };
      },
    }),
  ],
  providers: [ArticleSearchService],
  exports: [ArticleSearchService, NestElasticsearchModule],
})
export class ElasticsearchModule {}


