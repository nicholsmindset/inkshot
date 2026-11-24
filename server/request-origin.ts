// Trust configured origins and Vercel's exact preview deployment metadata only.
// Request Host / X-Forwarded-Host headers are deliberately not trusted.
export function allowedRequestOrigins(origin: string, production: boolean, env = process.env): string[] {
  const origins = [origin];
  if (!production) origins.push('http://127.0.0.1:5173', 'http://localhost:5173');
  if (env.VERCEL === '1' && env.VERCEL_ENV === 'preview') {
    for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      if (host && /^[a-z0-9-]+\.vercel\.app$/.test(host)) origins.push(`https://${host}`);
    }
  }
  return [...new Set(origins)];
}
