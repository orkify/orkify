/**
 * Where the embedded widget sends its API calls.
 *
 * The widget used to take this from the origin of its own script tag, which is
 * right when the script is served by the app (orkify.com/orkify-chat.js, and a
 * self-hosted instance on its own domain) and wrong for the very snippet the
 * dashboard hands out: loaded from a CDN, the widget asked
 * `cdn.jsdelivr.net/api/chat/config` and never appeared.
 *
 * Precedence: an explicit `data-api-base`, then the script's own origin unless
 * that is a public CDN, then this default.
 *
 * Used by the widget bundle (src/widget) and exported from the package, so the
 * dashboard that hands out the snippet names the same default.
 */
export const DEFAULT_API_BASE = 'https://orkify.com';

/**
 * Hosts that serve npm packages and therefore never serve this API. Matched on
 * the whole host or a dot-suffix of it, so a subdomain of a CDN counts and
 * `myjsdelivr.net` does not.
 */
const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'esm.run',
  'skypack.dev',
  'statically.io',
  'jspm.io',
];

function originOf(value: null | string | undefined): null | string {
  if (!value) return null;
  try {
    const url = new URL(value);
    // Only the two schemes a page can be served over; anything else is not an
    // API we could reach.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isCdn(origin: string): boolean {
  const host = new URL(origin).hostname.toLowerCase();
  return CDN_HOSTS.some((cdn) => host === cdn || host.endsWith(`.${cdn}`));
}

/**
 * @param scriptSrc `src` of the widget's own script tag.
 * @param dataApiBase the `data-api-base` attribute, for a site that hosts the
 *   script itself but talks to an Orkify elsewhere.
 */
export function resolveApiBase(
  scriptSrc: null | string | undefined,
  dataApiBase?: null | string
): string {
  const explicit = originOf(dataApiBase);
  if (explicit) return explicit;

  const scriptOrigin = originOf(scriptSrc);
  if (scriptOrigin && !isCdn(scriptOrigin)) return scriptOrigin;

  return DEFAULT_API_BASE;
}
