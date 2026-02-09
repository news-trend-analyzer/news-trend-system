export type Keyword = {
  id: number;
  normalizedText: string;
  coCount: number;
  weightSum: number;
  associationScore: number;
};

export type SearchKeyword = {
  id: number;
  normalizedText: string;
};