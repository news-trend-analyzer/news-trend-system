export type KeywordBriefingQuestion = {
  question: string;
  answer: string;
  interestCount: number;
};

export type KeywordBriefingTrendSignal = {
  label: string;
  changeRate: number;
  basis: string;
};

export type KeywordCommerceHint = {
  label: string;
  query: string;
  reason: string;
};

export type KeywordBriefing = {
  oneLineSummary: string;
  whySteps: string[];
  trendSignal: KeywordBriefingTrendSignal;
  questions: KeywordBriefingQuestion[];
  essentialArticleIds: number[];
  commerceHints: KeywordCommerceHint[];
};

export type LlmKeywordBriefing = {
  oneLineSummary: string;
  whySteps: string[];
  questions: Array<{
    question: string;
    answer: string;
  }>;
  commerceHints: KeywordCommerceHint[];
};
