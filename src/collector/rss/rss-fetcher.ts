import axios from 'axios';

/**
 * RSS URL에서 XML 데이터를 가져옴
 * @param url - RSS 피드 URL
 * @returns RSS XML 문자열 또는 null (실패 시)
 */
export async function fetchRSS(url: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>(url, {
      timeout: 5000,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (NewsCollector)',
      },
    });
    return data;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`RSS fetch error: ${url}`, errorMessage);
    return null;
  }
}
