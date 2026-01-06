import { RssSourceMap } from '../models/rss-source.model';

/**
 * RSS 소스 정의
 * 각 언론사별 카테고리와 RSS 피드 URL을 관리
 */
export const RSS_SOURCES: RssSourceMap = {
  yonhap: {
    name: '연합뉴스',
    feeds: {
      latest: 'https://www.yna.co.kr/rss/news.xml',
      politics: 'https://www.yna.co.kr/rss/politics.xml',
      economy: 'https://www.yna.co.kr/rss/economy.xml',
      market: 'https://www.yna.co.kr/rss/market.xml',
      industry: 'https://www.yna.co.kr/rss/industry.xml',
      society: 'https://www.yna.co.kr/rss/society.xml',
      culture: 'https://www.yna.co.kr/rss/culture.xml',
      entertainment: 'https://www.yna.co.kr/rss/entertainment.xml',
      sports: 'https://www.yna.co.kr/rss/sports.xml',
      opinion: 'https://www.yna.co.kr/rss/opinion.xml',
    },
  },
  yonhap_tv: {
    name: '연합뉴스TV',
    feeds: {
      latest: 'http://www.yonhapnewstv.co.kr/browse/feed/',
      politics: 'http://www.yonhapnewstv.co.kr/category/news/politics/feed/',
      economy: 'http://www.yonhapnewstv.co.kr/category/news/economy/feed/',
      society: 'http://www.yonhapnewstv.co.kr/category/news/society/feed/',
      culture: 'http://www.yonhapnewstv.co.kr/category/news/culture/feed/',
      sports: 'http://www.yonhapnewstv.co.kr/category/news/sports/feed/',
    },
  },
  jtbc: {
    name: 'JTBC 뉴스',
    feeds: {
      flash: 'https://news-ex.jtbc.co.kr/v1/get/rss/newsflesh',
      issue: 'https://news-ex.jtbc.co.kr/v1/get/rss/issue',
      politics: 'https://news-ex.jtbc.co.kr/v1/get/rss/section/politics',
      economy: 'https://news-ex.jtbc.co.kr/v1/get/rss/section/economy',
      society: 'https://news-ex.jtbc.co.kr/v1/get/rss/section/society',
      international: 'https://news-ex.jtbc.co.kr/v1/get/rss/section/international',
      culture: 'https://news-ex.jtbc.co.kr/v1/get/rss/section/culture',
      entertainment: 'https://news-ex.jtbc.co.kr/v1/get/rss/section/entertainment',
      sports: 'https://news-ex.jtbc.co.kr/v1/get/rss/section/sports',
      weather: 'https://news-ex.jtbc.co.kr/v1/get/rss/section/weather',
    },
  },
  // kmib: {
  //   name: '국민일보',
  //   feeds: {
  //     politics: 'https://www.kmib.co.kr/rss/data/kmibPolRss.xml',
  //     economy: 'https://www.kmib.co.kr/rss/data/kmibEcoRss.xml',
  //     society: 'https://www.kmib.co.kr/rss/data/kmibSocRss.xml',
  //     international: 'https://www.kmib.co.kr/rss/data/kmibIntRss.xml',
  //     entertainment: 'https://www.kmib.co.kr/rss/data/kmibEntRss.xml',
  //     sports: 'https://www.kmib.co.kr/rss/data/kmibSpoRss.xml',
  //     life: 'https://www.kmib.co.kr/rss/data/kmibLifeRss.xml',
  //   },
  // },
  chosun: {
    name: '조선일보',
    feeds: {
      politics: 'https://www.chosun.com/arc/outboundfeeds/rss/category/politics/?outputType=xml',
      economy: 'https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml',
      society: 'https://www.chosun.com/arc/outboundfeeds/rss/category/national/?outputType=xml',
      international: 'https://www.chosun.com/arc/outboundfeeds/rss/category/international/?outputType=xml',
      culture: 'https://www.chosun.com/arc/outboundfeeds/rss/category/culture-life/?outputType=xml',
      opinion: 'https://www.chosun.com/arc/outboundfeeds/rss/category/opinion/?outputType=xml',
      sports: 'https://www.chosun.com/arc/outboundfeeds/rss/category/sports/?outputType=xml',
      entertainment: 'https://www.chosun.com/arc/outboundfeeds/rss/category/entertainments/?outputType=xml',
    },
  },
  hankyung: {
    name: '한국경제',
    feeds: {
      politics: 'https://www.hankyung.com/feed/politics',
      economy: 'https://www.hankyung.com/feed/economy',
      finance: 'https://www.hankyung.com/feed/finance',
      realestate: 'https://www.hankyung.com/feed/realestate',
      it: 'https://www.hankyung.com/feed/it',
      international: 'https://www.hankyung.com/feed/international',
      society: 'https://www.hankyung.com/feed/society',
      life: 'https://www.hankyung.com/feed/life',
      opinion: 'https://www.hankyung.com/feed/opinion',
      sports: 'https://www.hankyung.com/feed/sports',
      entertainment: 'https://www.hankyung.com/feed/entertainment',
    },
  },
  newsis: {
    name: '뉴시스',
    feeds: {
      flash: 'https://www.newsis.com/RSS/sokbo.xml',
      international: 'https://www.newsis.com/RSS/international.xml',
      finance: 'https://www.newsis.com/RSS/bank.xml',
      society: 'https://www.newsis.com/RSS/society.xml',
      metro: 'https://www.newsis.com/RSS/met.xml',
      sports: 'https://www.newsis.com/RSS/sports.xml',
      culture: 'https://www.newsis.com/RSS/culture.xml',
      politics: 'https://www.newsis.com/RSS/politics.xml',
      economy: 'https://www.newsis.com/RSS/economy.xml',
      industry: 'https://www.newsis.com/RSS/industry.xml',
      health: 'https://www.newsis.com/RSS/health.xml',
      entertainment: 'https://www.newsis.com/RSS/entertain.xml',
    },
  },
  mk: {
    name: '매일경제',
    feeds: {
      headline: 'https://www.mk.co.kr/rss/30000001/',
      politics: 'https://www.mk.co.kr/rss/30200030/',
      society: 'https://www.mk.co.kr/rss/50400012/',
      business: 'https://www.mk.co.kr/rss/50100032/',
      stock: 'https://www.mk.co.kr/rss/50200011/',
      culture: 'https://www.mk.co.kr/rss/30000023/',
      sports: 'https://www.mk.co.kr/rss/71000001/',
      economy: 'https://www.mk.co.kr/rss/30100041/',
      international: 'https://www.mk.co.kr/rss/30300018/',
      realestate: 'https://www.mk.co.kr/rss/50300009/',
    },
  },
  donga: {
    name: '동아일보',
    feeds: {
      politics: 'https://rss.donga.com/politics.xml',
      society: 'https://rss.donga.com/national.xml',
      economy: 'https://rss.donga.com/economy.xml',
      international: 'https://rss.donga.com/international.xml',
      science: 'https://rss.donga.com/science.xml',
      culture: 'https://rss.donga.com/culture.xml',
      sports: 'https://rss.donga.com/sports.xml',
    },
  },
} as const;

/**
 * RSS 소스 키 타입
 */
export type RssSourceKey = keyof typeof RSS_SOURCES;
