import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF defence for every server-side fetch of a user-influenced URL.
 *
 * The previous guard (in cite-sight-core) only inspected literal IPs in the
 * supplied URL. That misses two obvious bypasses:
 *   1. DNS: `http://internal.attacker.com` resolves to a private address.
 *   2. Redirects: a public URL that 302s to `http://169.254.169.254/…`.
 *
 * `assertPublicUrl` resolves the hostname and rejects any private/reserved
 * address; `safeFetch` re-runs that check on every redirect hop. Callers
 * choose `allowPrivate` per deployment: the hosted server passes `false`,
 * the desktop app (a single-user localhost service) passes `true`.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 5;

/** True when a literal IP address is in a private / reserved range. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  // Not an IP literal. Callers only pass literals here; be safe if they don't.
  return true;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 (incl TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice(7));
  const first = lower.split(':')[0];
  if (/^f[cd]/.test(first)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(first)) return true; // fe80::/10 link-local
  if (first === 'ff') return true; // multicast
  if (first === '2001:db8') return true; // documentation
  return false;
}

/**
 * Validate that `raw` is an http(s) URL that does not resolve to a private or
 * reserved address. Returns the parsed URL, or throws an Error describing the
 * refusal. When `allowPrivate` is true only the scheme check is applied.
 */
export async function assertPublicUrl(raw: string, allowPrivate = false): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Refusing malformed URL');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Refusing URL with scheme ${url.protocol}`);
  }
  // Defuse userinfo tricks such as http://public@127.0.0.1/.
  if (url.username || url.password) {
    throw new Error('Refusing URL with embedded credentials');
  }
  if (allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Refusing private network address');
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error('Refusing unresolvable host');
  }
  if (!addresses.length) throw new Error('Refusing unresolvable host');
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new Error('Refusing private network address');
  }
  return url;
}

export interface SafeFetchOptions {
  allowPrivate?: boolean;
  maxRedirects?: number;
}

/**
 * `fetch` that re-validates the destination on every redirect hop, so a public
 * URL cannot redirect to an internal address. Redirects are followed manually
 * (`redirect: 'manual'`) for exactly that reason.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const allowPrivate = options.allowPrivate ?? false;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current, allowPrivate);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) {
        await res.body?.cancel().catch(() => {});
        current = new URL(location, current).toString();
        continue;
      }
    }
    return res;
  }
  throw new Error('Refusing too many redirects');
}