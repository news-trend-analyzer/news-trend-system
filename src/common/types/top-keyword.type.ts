export type TopKeyword = {
  id: number;
  displayText: string;
  freqSum: number;
  scoreSum: number;
};

export type RankedKeyword = {
  id: number;
  displayText: string;
  type: 'SINGLE' | 'COMPOSITE' | null;
  score24h: number;
  scoreRecent: number;
  scorePrev: number;
  diffScore: number;
  finalScore: number;
};
