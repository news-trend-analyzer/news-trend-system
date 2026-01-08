/**
 * XML 파서가 반환하는 원시 아이템 타입
 */
export interface RawXmlItem {
  title?: string | { '#text'?: string };
  link?: string | { href?: string };
  pubDate?: string;
  updated?: string;
  published?: string;
  description?: string;
  summary?: string;
}





