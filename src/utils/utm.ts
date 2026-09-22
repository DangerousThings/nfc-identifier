/**
 * UTM tracking for outbound links to Dangerous Things properties.
 * Single source of truth so every link uses the same source/medium encoding.
 */
export function buildTrackedUrl(
  baseUrl: string,
  content?: string,
  campaign = 'chip_scan',
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', 'dt_nfc_identifier');
  url.searchParams.set('utm_medium', 'app');
  url.searchParams.set('utm_campaign', campaign);
  if (content) {
    url.searchParams.set('utm_content', content);
  }
  return url.toString();
}
