import { safeFetch } from '../net/ssrf.js';

export interface PageMeta {
  ogImage?: string;
  description?: string;
  siteName?: string;
}

const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Extract og:image / description / site name from a page's <head>. The fetch is
 * SSRF-guarded (DNS + per-hop redirect revalidation) because the URL comes from
 * a web-search result, not from a trusted source (ADR-0005 layer 2; feeds
 * ADR-0011 rung 2). Regex-based on purpose: it only needs meta tags, not a DOM.
 */
export function parsePageMeta(html: string): PageMeta {
  const head = html.slice(0, MAX_HTML_BYTES);
  return {
    ogImage: metaContent(head, 'og:image'),
    description:
      metaContent(head, 'og:description') ?? metaContent(head, 'description', 'name'),
    siteName: metaContent(head, 'og:site_name'),
  };
}

function metaContent(
  html: string,
  key: string,
  attr: 'property' | 'name' = 'property',
): string | undefined {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Attribute order varies across sites; try both orderings.
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${k}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${k}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return decodeEntities(m[1].trim());
  }
  return undefined;
}

function decodeEntities(s: string): string {
  // Decode `&amp;` LAST so `&amp;lt;` becomes `&lt;` (a literal), never `<`.
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export async function fetchPageMeta(
  url: string,
  allowPrivate = false,
): Promise<PageMeta> {
  const res = await safeFetch(
    url,
    {
      headers: {
        accept: 'text/html',
        'user-agent':
          'honeyguide/0.7 (+https://github.com/michael-borck/honeyguide)',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
    { allowPrivate },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) return parsePageMeta(await res.text());
  // Cap how much we read — meta tags live in <head>.
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  void reader.cancel().catch(() => {});
  return parsePageMeta(Buffer.concat(chunks).toString('utf8'));
}