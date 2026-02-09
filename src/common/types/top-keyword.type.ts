export type TopKeyword = {
  id: number;
  normalizedText: string;
  freqSum: number;
  scoreSum: number;
};

export type RankedKeyword = {
  id: number;
  normalizedText: string;
  type: 'SINGLE' | 'COMPOSITE' | null;
  score24h: number;
  scoreRecent: number;
  scorePrev: number;
  diffScore: number;
  finalScore: number;
};
