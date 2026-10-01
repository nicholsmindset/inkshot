import { config, AppError } from "./config.js";
const BASE = "https://api.higgsfield.ai";
export const MODELS = {
  image: "higgsfield-ai/soul/v2/standard",
  video: "kling-video/v3.0/std/image-to-video",
};
export type HFStatus = {
  status: string;
  request_id: string;
  status_url?: string;
  images?: { url: string }[];
  video?: { url: string };
  error?: unknown;
};
async function hf<T>(route: string, body?: unknown, key?: string): Promise<T> {
  if (!config.liveAllowed || !config.hfKey || !config.hfSecret)
    throw new AppError(503, "Live generation is not configured.");
  const url = new URL(route, BASE);
  if (url.origin !== BASE) throw new Error("Unexpected provider status host");
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Key ${config.hfKey}:${config.hfSecret}`,
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const error = new AppError(
      response.status >= 500 ? 503 : 502,
      `Generation provider returned ${response.status}.`,
    );
    throw error;
  }
  return response.json() as Promise<T>;
}
export const estimate = (model: string, input: unknown) =>
  hf<{ usd: string; credits: string }>(`/estimate/${model}`, input);
export const submit = (model: string, input: unknown, key: string) =>
  hf<HFStatus>(`/${model}`, input, key);
export const status = (id: string) =>
  hf<HFStatus>(`/requests/${encodeURIComponent(id)}/status`);
