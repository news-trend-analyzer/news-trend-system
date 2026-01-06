import { XMLParser } from 'fast-xml-parser';
import { ParsedRssItem } from '../models/article.model';
import { RawXmlItem } from '../models/xml-item.model';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

/**
 * RSS XML 문자열을 파싱하여 기사 아이템 배열로 변환
 * @param xml - RSS XML 문자열
 * @returns 파싱된 기사 아이템 배열
 */
export function parseRSS(xml: string): ParsedRssItem[] {
  const data = parser.parse(xml);
  const rawItems =
    data?.rss?.channel?.item ??
    data?.RDF?.item ??
    data?.feed?.entry ??
    [];
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  return items.map(convertToParsedItem);
}

/**
 * 원시 XML 아이템을 ParsedRssItem으로 변환
 * @param item - 원시 XML 아이템
 * @returns 파싱된 RSS 아이템
 */
function convertToParsedItem(item: RawXmlItem): ParsedRssItem {
  const title = extractTitle(item);
  const link = extractLink(item);
  const pubDate = extractPubDate(item);
  const description = extractDescription(item);
  return { title, link, pubDate, description };
}

/**
 * 아이템에서 제목 추출
 */
function extractTitle(item: RawXmlItem): string {
  if (typeof item.title === 'string') {
    return item.title;
  }
  if (item.title && typeof item.title === 'object' && item.title['#text']) {
    return item.title['#text'];
  }
  return '';
}

/**
 * 아이템에서 링크 추출
 */
function extractLink(item: RawXmlItem): string {
  if (typeof item.link === 'string') {
    return item.link;
  }
  if (item.link && typeof item.link === 'object' && item.link.href) {
    return item.link.href;
  }
  return '';
}

/**
 * 아이템에서 발행일 추출
 */
function extractPubDate(item: RawXmlItem): string | null {
  return item.pubDate || item.updated || item.published || null;
}

/**
 * 아이템에서 설명 추출
 */
function extractDescription(item: RawXmlItem): string | null {
  return item.description || item.summary || null;
}
