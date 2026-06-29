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

export type KeywordBriefing = {
  oneLineSummary: string;
  whySteps: string[];
  trendSignal: KeywordBriefingTrendSignal;
  questions: KeywordBriefingQuestion[];
  essentialArticleIds: number[];
};

export type LlmKeywordBriefing = {
  oneLineSummary: string;
  whySteps: string[];
  questions: Array<{
    question: string;
    answer: string;
  }>;
};
