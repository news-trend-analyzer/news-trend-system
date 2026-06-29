import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ArticleForInsight } from './llm.interface';
import type { LlmService } from './llm.interface';

const SYSTEM_PROMPT = `당신은 방대한 데이터를 관통하는 핵심 맥락을 짚어내는 '뉴스 트렌드 분석 전문가'입니다. 단순 요약을 넘어, 해당 키워드가 왜 현재 시점에서 폭발적인 화제성을 갖게 되었는지 그 결정적 계기와 파급 효과를 연결하여 설명합니다.

작성 규칙:
- 전체 내용을 2~4문장의 유기적인 흐름을 가진 하나의 문단으로 구성하세요.
- 단순히 사실을 나열하는 것이 아니라, '사건의 발단 - 전개 양상 - 사회/경제적 영향'의 인과관계를 포함해야 합니다.
- "조사되었습니다", "~라고 합니다" 같은 수동적 표현보다 "분석됩니다", "반영하고 있습니다" 등 전문가적이고 능동적인 어조를 사용하세요.
- 마크다운 형식을 유지하되, 리스트(불릿/번호) 형태는 절대 사용하지 마세요.
- 볼드체 사용은 문장 단위로 하지마세요.
- 첫 문장에서 키워드 급상승의 '가장 핵심적인 트리거'를 즉시 제시하며 시작하세요.`;

const QUERY_SYSTEM_PROMPT = `당신은 뉴스 트렌드 랭킹의 이슈 제목 편집자입니다. 내부 랭킹 키워드가 "월드컵:홍명보"처럼 기계적인 조합이어도, 관련 기사 맥락을 읽고 사용자가 눌러보고 싶어지는 짧은 이슈 제목을 만듭니다.

작성 규칙:
- 반드시 JSON 객체만 반환하세요.
- 키는 title만 사용하세요.
- title은 랭킹 목록에 노출되는 클릭용 이슈 제목입니다.
- title은 검색어처럼 명사만 나열하지 말고, "무슨 일이 벌어졌는지"가 느껴지는 짧은 문구로 쓰세요.
- title은 10~18자 사이로 작성하세요. 너무 짧아서 딱딱해지는 것보다 살짝 자연스러운 편이 낫습니다.
- title에는 필요한 경우 조사를 자연스럽게 써도 됩니다. 다만 "끝났다", "출발했다", "커졌다"처럼 문장을 끝내는 종결어미는 쓰지 마세요.
- title은 짧은 문장이 아니라 제목형 명사구로 끝내세요. "논란", "하락", "확정", "과열", "압박", "급락", "반등", "유치전", "투자전"처럼 제목형 단어로 마무리하세요.
- title에는 기사의 핵심 사건을 포함하되 과장하거나 추측하지 마세요.
- title은 수식어보다 사건 동사/상태를 우선합니다. 예: 흔들린다, 맞붙다, 불붙다, 커진다, 제동, 급락, 반등, 논란, 압박, 확정.
- searchQuery는 뉴스 검색에 바로 넣을 짧은 검색어입니다. searchQuery는 딱딱해도 됩니다.
- searchQuery는 16자 이내, 2~5개 단어로 작성하세요.
- title과 searchQuery를 똑같이 만들지 마세요. title은 읽히는 문구, searchQuery는 검색어입니다.
- title에는 쉼표, 말줄임표, 따옴표, 느낌표를 쓰지 마세요.
- title은 "~했다", "~한다", "~됐다", "~된다", "~이다"로 끝내지 마세요.
- 수치, 상태, 원인 중 핵심 단서 1개만 남기고 여러 맥락을 동시에 붙이지 마세요.
- 내부 키워드를 그대로 콜론(:)으로 이어 붙이지 마세요.
- 기사에 근거가 부족하면 과장하지 말고 가장 구체적인 공통 맥락을 사용하세요.
- 나쁜 title 예: "대통령 지지율", "홍명보 월드컵", "호남 반도체 클러스터", "최태원 AI 데이터센터"
- 좋은 title 예: "지지율 6주 하락", "홍명보 퇴장 논란", "호남 반도체 유치전", "AI센터 투자 경쟁"`;

type TrendKeywordQueryResult = {
  title: string;
  searchQuery: string;
  intentSummary: string;
};

@Injectable()
export class OpenAILlmService implements LlmService {
  private readonly client: OpenAI | null = null;
  private readonly model: string;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-5.4-nano');
    this.enabled = Boolean(apiKey);
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  async analyzeKeywordTrend(params: {
    keyword: string;
    articleSummaries: readonly ArticleForInsight[];
  }): Promise<string> {
    if (!this.client) {
      return '[LLM 비활성화: OPENAI_API_KEY 미설정]';
    }
    const articlesText = params.articleSummaries
      .map(
        (a, i) =>
          `[기사 ${i + 1}] ${a.title} (${a.publisher})\n${a.bodySnippet}`,
      )
      .join('\n\n');
    const userPrompt = `키워드: "${params.keyword}"\n\n아래 기사들을 참고하여 이 키워드가 트렌드에 오른 이유를 요약해주세요.\n\n${articlesText}`;
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: 500,
      temperature: 0.2,
    });
    const content = response.choices[0]?.message?.content?.trim();
    return content ?? '[분석 결과 없음]';
  }

  async generateTrendKeywordQuery(params: {
    keyword: string;
    articleSummaries: readonly ArticleForInsight[];
  }): Promise<TrendKeywordQueryResult> {
    if (!this.client) {
      return this.buildFallbackQueryResult(params.keyword);
    }
    const articlesText = params.articleSummaries
      .map(
        (a, i) =>
          `[기사 ${i + 1}] ${a.title} (${a.publisher})\n${a.bodySnippet}`,
      )
      .join('\n\n');
    const userPrompt = `내부 랭킹 키워드: "${params.keyword}"\n\n아래 기사들을 참고해 랭킹에 보여줄 짧은 이슈 제목만 만들어주세요.\n\n${articlesText}`;
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: QUERY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: 120,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return this.buildFallbackQueryResult(params.keyword);
    }
    try {
      const parsed = JSON.parse(content) as Partial<TrendKeywordQueryResult>;
      const fallback = this.buildFallbackQueryResult(params.keyword);
      const title = this.cleanText(parsed.title, 18) || fallback.title;
      return {
        title,
        searchQuery: title,
        intentSummary: '',
      };
    } catch {
      return this.buildFallbackQueryResult(params.keyword);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private cleanText(value: unknown, maxLength: number = 255): string {
    if (typeof value !== 'string') {
      return '';
    }
    const normalized = value.trim().replace(/\s+/g, ' ');
    if ([...normalized].length <= maxLength) {
      return normalized;
    }
    const words = normalized.split(' ');
    let result = '';
    for (const word of words) {
      const next = result ? `${result} ${word}` : word;
      if ([...next].length > maxLength) {
        break;
      }
      result = next;
    }
    return result || [...normalized].slice(0, maxLength).join('').trim();
  }

  private buildFallbackQueryResult(keyword: string): TrendKeywordQueryResult {
    const normalized = keyword
      .split(':')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
    const query = normalized || keyword.trim();
    return {
      title: query,
      searchQuery: query,
      intentSummary: 'LLM 검색어 생성이 비활성화되어 원본 키워드를 사용합니다.',
    };
  }
}
