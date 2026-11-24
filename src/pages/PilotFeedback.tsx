import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Button, Field, Notice } from "../ui";

type Answer = "yes_as_is" | "yes_with_edits" | "no";
const reasons = [["wrong_product", "Wrong product"], ["wrong_claim", "Wrong claim"], ["looks_ai_made", "Looks AI-made"], ["text_issue", "Text issue"], ["other", "Other"]] as const;

// Asked once a merchant has downloaded an asset. The answer can be changed by answering again.
export function PublishQuestion({ assetId, versionId }: { assetId: string; versionId: string }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  async function send(next: Answer, reason?: string) {
    setError("");
    try { await api(`/assets/${assetId}/publish-answer`, { versionId, answer: next, reason }); setAnswer(next); setSaved(next !== "no" || !!reason); }
    catch (e) { setError((e as Error).message); }
  }
  if (saved) return <p className="pilot-question" role="status">Thanks, that helps us improve.</p>;
  return (
    <fieldset className="pilot-question">
      <legend>Would you publish this?</legend>
      {answer !== "no" ? (
        <div className="pilot-question-options">
          <Button type="button" variant="secondary" onClick={() => void send("yes_as_is")}>Yes, as is</Button>
          <Button type="button" variant="secondary" onClick={() => void send("yes_with_edits")}>Yes, with edits</Button>
          <Button type="button" variant="secondary" onClick={() => void send("no")}>No</Button>
        </div>
      ) : (
        <div className="pilot-question-options">
          <span>What was the main problem? (optional)</span>
          {reasons.map(([value, label]) => <Button key={value} type="button" variant="secondary" onClick={() => void send("no", value)}>{label}</Button>)}
          <Button type="button" variant="ghost" onClick={() => setSaved(true)}>Skip</Button>
        </div>
      )}
      {error ? <Notice>{error}</Notice> : null}
    </fieldset>
  );
}

type Pending = { campaignId: string; campaignName: string; assets: { id: string; title: string; kind: string }[] } | null;
// Shown on a later visit, seven days after the first download of a campaign.
export function PostingFollowup() {
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => { void api<{ pending: Pending }>("/pilot/followup").then(r => setPending(r.pending)).catch(() => {}); }, []);
  if (!pending || done) return null;
  const number = (form: FormData, key: string) => { const raw = String(form.get(key) || "").trim(); return raw === "" ? undefined : Number(raw); };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pending) return;
    setBusy(true); setError("");
    const form = new FormData(e.currentTarget);
    const posted = form.get("posted") === "yes";
    try {
      await api("/pilot/followup", {
        campaignId: pending.campaignId, posted,
        ...(posted && form.get("assetId") ? { assetId: String(form.get("assetId")) } : {}),
        ...(posted && form.get("platform") ? { platform: String(form.get("platform")) } : {}),
        spend: number(form, "spend"), results: String(form.get("results") || "").trim() || undefined,
        clicks: number(form, "clicks"), messages: number(form, "messages"), orders: number(form, "orders"),
      });
      setDone(true);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function dismiss() {
    if (!pending) return;
    try { await api("/pilot/followup", { campaignId: pending.campaignId, dismissed: true }); } catch { /* optional */ }
    setDone(true);
  }
  return (
    <section className="pilot-followup" aria-labelledby="followup-heading">
      <div><h2 id="followup-heading">Did you post any of these? How did it go?</h2>
        <p>About “{pending.campaignName}”. Your answers are self-reported and optional. They help us see what works.</p></div>
      <form onSubmit={submit}>
        <Field label="Did you post any of this campaign?"><select name="posted" defaultValue="yes"><option value="yes">Yes</option><option value="no">Not yet</option></select></Field>
        <Field label="Which asset?"><select name="assetId" defaultValue=""><option value="">Not sure / several</option>{pending.assets.map(a => <option key={a.id} value={a.id}>{a.title} · {a.kind}</option>)}</select></Field>
        <Field label="Where did you post?"><select name="platform" defaultValue=""><option value="">Choose</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="whatsapp">WhatsApp</option><option value="other">Other</option></select></Field>
        <Field label="Ad spend, if any (optional)"><input name="spend" type="number" min="0" step="0.01" inputMode="decimal" /></Field>
        <Field label="How did it go, in your own words?"><textarea name="results" maxLength={1000} rows={3} /></Field>
        <Field label="Clicks (optional)"><input name="clicks" type="number" min="0" step="1" inputMode="numeric" /></Field>
        <Field label="Messages (optional)"><input name="messages" type="number" min="0" step="1" inputMode="numeric" /></Field>
        <Field label="Orders (optional)"><input name="orders" type="number" min="0" step="1" inputMode="numeric" /></Field>
        {error ? <Notice>{error}</Notice> : null}
        <div className="pilot-followup-actions"><Button busy={busy}>Send</Button><Button type="button" variant="ghost" onClick={() => void dismiss()}>Not now</Button></div>
      </form>
    </section>
  );
}
