import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ArticleForInsight } from './llm.interface';
import type { LlmService } from './llm.interface';

const SYSTEM_PROMPT = `당신은 뉴스 트렌드 분석 전문가입니다. 제공된 기사들을 바탕으로 특정 키워드가 왜 지금 주목받고 있는지 핵심만 짚어 요약합니다.

작성 규칙:
- 2~4문장의 자연스러운 한국어 문단으로 작성
- 핵심 사건·이슈·배경을 중심으로 설명
- 마크다운, 불릿, 번호 목록 사용 금지
- 불필요한 수식어나 중복 표현 없이 간결하게`;

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
