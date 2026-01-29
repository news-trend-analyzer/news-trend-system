import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticleEntity } from './entities/article.entity';
import { KeywordEntity } from './entities/keyword.entity';
import { ArticleKeywordEntity } from './entities/article-keyword.entity';
import { KeywordTimeseriesEntity } from './entities/keyword-timeseries.entity';
import { KeywordAliasEntity } from './entities/keyword-alias.entity';
import { ArticleRepository } from './article.repository';
import { KeywordRepository } from './keyword.repository';

/**
 * 데이터베이스 연동 모듈
 * TypeORM을 사용하여 PostgreSQL 연결
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');
        if (databaseUrl) {
          return {
            type: 'postgres',
            url: databaseUrl,
            entities: [
              ArticleEntity,
              KeywordEntity,
              ArticleKeywordEntity,
              KeywordTimeseriesEntity,
              KeywordAliasEntity,
            ],
            synchronize: false,
            logging: configService.get<string>('NODE_ENV') === 'development',
          };
        }
        return {
          type: 'postgres',
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'trendlab'),
          password: configService.get<string>('DB_PASSWORD', 'trendlab_password'),
          database: configService.get<string>('DB_DATABASE', 'trendlab'),
          entities: [
            ArticleEntity,
            KeywordEntity,
            ArticleKeywordEntity,
            KeywordTimeseriesEntity,
            KeywordAliasEntity,
          ],
          synchronize: false,
          logging: configService.get<string>('NODE_ENV') === 'development',
        };
      },
    }),
    TypeOrmModule.forFeature([
      ArticleEntity,
      KeywordEntity,
      ArticleKeywordEntity,
      KeywordTimeseriesEntity,
      KeywordAliasEntity,
    ]),
  ],
  providers: [ArticleRepository, KeywordRepository],
  exports: [TypeOrmModule, ArticleRepository, KeywordRepository],
})
export class DatabaseModule {}

