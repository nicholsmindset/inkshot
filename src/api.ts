export async function api<T = unknown>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method: method || (body ? "POST" : "GET"),
    headers:
      body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : undefined,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "Something did not finish. Please try again."),
      { status: response.status },
    );
  return data as T;
}
export const media = (id: string, preview = false) =>
  `/api/media/${id}${preview ? "?preview=true" : ""}`;
