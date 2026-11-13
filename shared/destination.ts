/** The publishing link is printed in campaign copy, never fetched by the server. */
export function isCampaignDestination(value: string): boolean {
  if (!/^https:\/\//i.test(value) || /[\s\\]/.test(value) || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}
