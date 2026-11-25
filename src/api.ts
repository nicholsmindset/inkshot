// Set once from /api/health so error messages can name the support address.
let supportEmail = "";
export const setSupportEmail = (value: string | null | undefined) => { supportEmail = value ?? ""; };
export async function api<T = unknown>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
    method: method || (body ? "POST" : "GET"),
    headers:
      body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : undefined,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Could not connect to Inkshot. Check your connection and try again.");
  }
  if (response.status === 204) return undefined as T;
  let data;
  try {
    data = await response.json();
  } catch {
    throw Object.assign(new Error(response.ok
      ? "Inkshot returned an unreadable response. Please try again."
      : "Inkshot is temporarily unavailable. Please try again."), { status: response.ok ? 502 : response.status });
  }
  if (!response.ok) {
    let message = typeof data?.error === "string" ? data.error : "Something did not finish. Please try again.";
    if (typeof data?.reference === "string" && /^[a-f0-9-]{8,36}$/i.test(data.reference)) {
      message += ` Reference ${data.reference}`;
      if (supportEmail) message += `. If it keeps happening, email ${supportEmail} and quote this reference.`;
    }
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data as T;
}
export const media = (id: string, preview = false) =>
  `/api/media/${id}${preview ? "?preview=true" : ""}`;
