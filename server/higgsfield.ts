import { providerWebhookUrl } from "./provider-webhooks.js";
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
async function hf<T>(route: string, body?: unknown, key?: string, signal?: AbortSignal): Promise<T> {
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
    signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
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
export const estimate = (model: string, input: unknown, signal?: AbortSignal) =>
  hf<{ usd: string; credits: string }>(`/estimate/${model}`, input, undefined, signal);
export const submit = (model: string, input: unknown, key: string, signal?: AbortSignal) => {
  const callback = providerWebhookUrl();
  return hf<HFStatus>(`/${model}${callback ? `?hf_webhook=${encodeURIComponent(callback)}` : ""}`, input, key, signal);
};
export const status = (id: string, signal?: AbortSignal) =>
  hf<HFStatus>(`/requests/${encodeURIComponent(id)}/status`, undefined, undefined, signal);
