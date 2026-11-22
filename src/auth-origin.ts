// Move to the configured auth host before collecting credentials or setting PKCE cookies.
export function canonicalAuthDestination(origin: string | null, currentUrl: string): string | null {
  if (!origin) return null; // Local development uses the current browser origin.
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin || configured.username || configured.password)
    throw new Error("The sign-in address is not configured correctly.");
  const current = new URL(currentUrl);
  if (current.origin === origin) return null;
  const path = ["/login", "/signup", "/forgot-password"].includes(current.pathname) ? current.pathname : "/login";
  const destination = new URL(path, origin);
  // Never carry auth codes, tokens, passwords or arbitrary redirect parameters.
  if ((path === "/signup" || path === "/login") && current.searchParams.has("website"))
    destination.searchParams.set("website", current.searchParams.get("website")!.slice(0, 2048));
  return destination.href;
}
