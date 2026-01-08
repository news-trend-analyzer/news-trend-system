import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { ArticleSearchService } from './article-search.service';
import { Article } from '../../collector/models/article.model';

type ElasticsearchServiceMock = {
  indices: {
    exists: jest.Mock<Promise<boolean>, [Record<string, unknown>]>;
    create: jest.Mock<Promise<void>, [Record<string, unknown>]>;
  };
  bulk: jest.Mock<Promise<{ errors: boolean }>, [Record<string, unknown>]>;
  index: jest.Mock<Promise<void>, [Record<string, unknown>]>;
};

describe('ArticleSearchService', () => {
  let service: ArticleSearchService;
  let elasticsearchService: ElasticsearchServiceMock;

  beforeEach(async () => {
    elasticsearchService = {
      indices: {
        exists: jest.fn(),
        create: jest.fn(),
      },
      bulk: jest.fn(),
      index: jest.fn(),
    };
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => defaultValue),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArticleSearchService,
        {
          provide: ElasticsearchService,
          useValue: elasticsearchService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();
    service = module.get<ArticleSearchService>(ArticleSearchService);
  });

  it('creates index when missing on init', async () => {
    elasticsearchService.indices.exists.mockResolvedValue(false);
    elasticsearchService.indices.create.mockResolvedValue();
    await service.onModuleInit();
    expect(elasticsearchService.indices.create).toHaveBeenCalled();
  });

  it('calls bulk with mapped documents', async () => {
    elasticsearchService.indices.exists.mockResolvedValue(true);
    elasticsearchService.bulk.mockResolvedValue({ errors: false });
    const articles: Article[] = [
      {
        title: 't1',
        link: 'l1',
        pubDate: '2024-01-01T00:00:00Z',
        description: 'd1',
        press: 'p',
        category: 'c',
        collectedAt: '2024-01-01T00:00:01Z',
      },
    ];
    await service.onModuleInit();
    await service.bulkIndexArticles(articles);
    expect(elasticsearchService.bulk).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            index: expect.objectContaining({ _id: 'l1' }),
          }),
          expect.objectContaining({
            title: 't1',
            link: 'l1',
          }),
        ]),
      }),
    );
  });
});


