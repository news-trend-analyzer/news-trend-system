/**
 * 중복 체크를 위한 메모리 저장소
 * TODO: 서버 재시작 시 초기화되므로 영구 저장소로 개선 필요
 */
const seen = new Set<string>();

/**
 * 기사 URL이 새로운 기사인지 확인
 * @param url - 확인할 기사 URL
 * @returns 새로운 기사면 true, 이미 본 기사면 false
 */
export function isNewArticle(url: string): boolean {
  if (!url) {
    return false;
  }
  if (seen.has(url)) {
    return false;
  }
  seen.add(url);
  return true;
}

/**
 * 중복 체크 저장소 초기화
 */
export function resetSeenArticles(): void {
  seen.clear();
}
