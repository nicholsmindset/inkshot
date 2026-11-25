import { useEffect, useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import { api } from "../api";
import { Button, Notice } from "../ui";
import type { Campaign } from "../../shared/types";

type Limit = { max: number | { cold: number; warm: number; hot: number }; visible?: number };
type Variant = { variant_id: string; concept_id: string; placement: string; angle: string; funnel_stage: "cold" | "warm" | "hot"; hook_type: string; fields: Record<string, unknown>; charCounts: Record<string, number>; needs_human_review: boolean; compliance_notes: string[]; video_script?: unknown };
type Violation = { variantId: string; field: string; rule: string; message: string; severity: "error" | "warn" };
type CopyResult = { sample: boolean; variants: Variant[]; violations: Violation[]; missingInputs: string[]; needsReview: boolean; repaired: boolean; aiDisclosure: { required: boolean; steps: string[] }; run?: number };
type Listing = { specsVersion: string; reverifyBy: string; rewritesAllowed: number; platforms: { id: string; label: string; runs: number; limits: Record<string, Limit> }[]; results: Record<string, CopyResult> };

const maxFor = (limit: Limit, stage: Variant["funnel_stage"]) => typeof limit.max === "number" ? limit.max : limit.max[stage];
const pretty = (key: string) => key.replace(/_/g, " ");

// Platform-ready copy written from the campaign's three chosen angles. Limits are recommended
// display lengths from the platforms, shown beside every field so nothing is cut off unseen.
export function PlatformCopy({ campaignId, campaign }: { campaignId: string; campaign: Campaign }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [active, setActive] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => {
    void api<Listing>(`/campaigns/${campaignId}/copy`).then(l => { setListing(l); setActive(a => a || l.platforms[0]?.id || ""); }).catch(() => {});
  }, [campaignId]);
  if (!listing || !listing.platforms.length) return null;
  const platform = listing.platforms.find(p => p.id === active) ?? listing.platforms[0];
  const result = listing.results[platform.id];
  const runs = platform.runs;
  const angleTitle = (id: string) => campaign.concepts.find(c => c.id === id)?.title ?? id;

  async function generate() {
    setBusy(platform.id); setError("");
    try {
      const next = await api<CopyResult>(`/campaigns/${campaignId}/copy`, { platform: platform.id });
      setListing(l => l && { ...l, results: { ...l.results, [platform.id]: next }, platforms: l.platforms.map(p => p.id === platform.id ? { ...p, runs: p.runs + 1 } : p) });
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied(c => c === key ? "" : c), 1500); } catch { setError("Your browser blocked copying. Select the text and copy it manually."); }
  }
  const flags = (v: Variant) => (result?.violations ?? []).filter(x => x.variantId === v.variant_id || x.variantId === "*");

  return (
    <section className="platform-copy" aria-labelledby="platform-copy-heading">
      <div className="platform-copy-head">
        <div>
          <span className="eyebrow">WRITTEN FOR WHERE YOU POST</span>
          <h2 id="platform-copy-heading">Platform copy</h2>
          <p>Captions, headlines and scripts for each platform, built on your three chosen angles. Check every fact and claim before you publish.</p>
        </div>
      </div>
      <div role="tablist" aria-label="Platform" className="platform-tabs">
        {listing.platforms.map(p => (
          <button key={p.id} role="tab" type="button" aria-selected={p.id === platform.id} className={p.id === platform.id ? "active" : ""} onClick={() => { setActive(p.id); setError(""); }}>
            {p.label}{listing.results[p.id] ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div className="platform-copy-actions">
        <Button busy={busy === platform.id} disabled={!!busy || runs >= listing.rewritesAllowed} onClick={() => void generate()}>
          <Sparkles size={16} /> {result ? `Rewrite ${platform.label} copy` : `Write ${platform.label} copy`}
        </Button>
        <small>{runs} of {listing.rewritesAllowed} writes used for this platform</small>
      </div>
      {error ? <Notice>{error}</Notice> : null}
      {result ? (
        <>
          {result.sample && <p className="preview-banner">Sample copy: shows the layout and limits. Real platform copy is written when AI writing is on.</p>}
          {result.needsReview && <Notice>Some lines need your attention before publishing. They are marked below.</Notice>}
          <details className="platform-disclosure" open={result.aiDisclosure.required}>
            <summary>{result.aiDisclosure.required ? "AI disclosure checklist (needed for this campaign)" : "AI disclosure reminders"}</summary>
            <ul>{result.aiDisclosure.steps.map(step => <li key={step}>{step}</li>)}</ul>
          </details>
          {Object.entries(result.variants.reduce<Record<string, Variant[]>>((groups, v) => ({ ...groups, [v.concept_id]: [...(groups[v.concept_id] ?? []), v] }), {})).map(([conceptId, variants]) => (
            <div key={conceptId} className="platform-angle">
              <h3>{angleTitle(conceptId)}</h3>
              <div className="platform-variants">
                {variants.map(v => (
                  <article key={v.variant_id} className="platform-variant">
                    <header><strong>Version {v.variant_id}</strong><span>{pretty(v.hook_type)} hook · {pretty(v.angle)} · {v.placement}</span></header>
                    {Object.entries(v.fields).filter(([, value]) => typeof value === "string" && value).map(([field, value]) => {
                      const limit = platform.limits[field];
                      const count = v.charCounts[field] ?? 0;
                      const max = limit ? maxFor(limit, v.funnel_stage) : undefined;
                      const key = `${v.variant_id}:${field}`;
                      return (
                        <div key={field} className="platform-field">
                          <div><span>{pretty(field)}</span>{max !== undefined && <small className={count > max ? "over" : ""}>{count}/{max}{limit?.visible && count > limit.visible ? ` · ${limit.visible} show before “more”` : ""}</small>}</div>
                          <p>{String(value)}</p>
                          <Button type="button" variant="small secondary" onClick={() => void copy(key, String(value))}><Copy size={14} /> {copied === key ? "Copied" : "Copy"}</Button>
                        </div>
                      );
                    })}
                    {Array.isArray(v.fields.hashtags) && v.fields.hashtags.length > 0 && <p className="platform-tags">{(v.fields.hashtags as string[]).join(" ")}</p>}
                    {flags(v).length > 0 && <ul className="platform-flags" aria-label="Needs your review">{flags(v).map((f, i) => <li key={i} className={f.severity}>{f.message}</li>)}</ul>}
                  </article>
                ))}
              </div>
            </div>
          ))}
          {result.missingInputs.length > 0 && <p className="platform-missing">Add these to your brief for stronger copy: {result.missingInputs.join(", ")}.</p>}
        </>
      ) : null}
      <small className="platform-specs">Character limits are the platforms’ recommended display lengths (checked {listing.specsVersion}) and can change. Re-check in your ad manager before launch.</small>
    </section>
  );
}
