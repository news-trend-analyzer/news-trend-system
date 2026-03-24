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
- 첫 문장에서 키워드 급상승의 '가장 핵심적인 트리거'를 즉시 제시하며 시작하세요.`;

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

  isEnabled(): boolean {
    return this.enabled;
  }
}
