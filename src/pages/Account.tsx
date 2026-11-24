import { AccountDeletion } from "./AccountDeletion";
import {useEffect, useRef, useState} from "react";
import {api} from "../api";
import {
  Check,
  Feather,
  ReceiptText,
  ShieldCheck,
  KeyRound,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import { useStudio } from "../context";
import { formatPrice } from "../plan";
import { Highlight, Button, Empty, Notice } from "../ui";
export function Billing() {
  const { studio } = useStudio();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function openBilling(action:'checkout'|'portal') {
    setBusy(true);setError('');
    try {const {url}=await api<{url:string}>(`/billing/${action}`,{});window.location.assign(url);}
    catch(e){setError((e as Error).message);setBusy(false);}
  }
  if (!studio) return null;
  const plan = studio.plan;
  if (!plan) return null;
  const regen = studio.videoRegen;
  const canSubscribe = ["none", "canceled", "incomplete_expired"].includes(studio.billingStatus);
  const live = studio.billingMode === "live";
  const checkoutHeld = live && canSubscribe && !studio.checkoutReleased;
  let billingLabel = live ? "Manage subscription" : "Manage test subscription";
  if (canSubscribe) billingLabel = live ? `Subscribe for ${formatPrice(plan)}/month` : "Test subscription checkout";
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A LITTLE CLARITY</span>
          <h1>
            Room to{" "}
            <Highlight>
              <em>create.</em>
            </Highlight>
          </h1>
          <p>Your plan, your credits, and exactly where they go.</p>
        </div>
        <span className="pill">{studio.billingMode === 'live' ? 'Your subscription' : 'Preview workspace'}</span>
      </div>
      <div className="billing-grid">
        <section className="plan-card">
          <div className="section-heading">
            <h2>Studio</h2>
            <span className="pill">{studio.billingMode === 'live' ? 'Monthly plan' : 'Planned launch plan'}</span>
          </div>
          <div className="price">
            {formatPrice(plan)} <small>{plan.currency.toUpperCase()} / month</small>
          </div>
          <p>One small business. Three complete campaigns.</p>
          <ul>
            {[
              `Each monthly payment tops your balance up to ${plan.credits} credits. Unused credits do not roll over.`,
              `Up to ${plan.videoRegenMonthlyCap} video regenerations each month`,
              "Text and layout edits included",
              "Version history and downloads",
              "Extra generation uses credits shown before approval",
            ].map((t) => (
              <li key={t}>
                <Check size={16} />
                {t}
              </li>
            ))}
          </ul>
          {error ? <Notice>{error}</Notice> : null}
          <Button className="full" disabled={!studio.billingEnabled || checkoutHeld} busy={busy} onClick={()=>openBilling(canSubscribe ? 'checkout' : 'portal')}>
            {studio.billingMode === 'off' ? 'Payments are off during preview' : checkoutHeld ? 'Subscriptions open soon' : studio.billingEnabled ? billingLabel : 'Checkout is not configured yet'}
          </Button>
          <small>{studio.billingMode === 'live' ? 'Renews monthly. Cancel in the billing portal to end your subscription at the end of the billing period.' : studio.billingMode === 'sandbox' ? 'Stripe sandbox only. No real payment is collected.' : 'No payment is collected. The plan shown is for the planned launch.'}</small>
        </section>
        <section className="balance-panel">
          <Feather size={25} />
          <span className="eyebrow">READY WHEN YOU ARE</span>
          <h2>
            <Highlight>{studio.balance}</Highlight>
          </h2>
          <p>{studio.billingMode === 'live' ? 'credits available' : 'preview credits available'}</p>
          <div className="credit-track">
            <i style={{ width: `${Math.min(100, (studio.balance / plan.credits) * 100)}%` }} />
          </div>
          <div className="credit-explainer">
            <div>
              <span>Complete kit</span>
              <strong>{plan.kitCredits} credits</strong>
            </div>
            <div>
              <span>Video regeneration</span>
              <strong>{plan.versionCredits.video} credits</strong>
            </div>
            <div>
              <span>Image regeneration</span>
              <strong>{plan.versionCredits.image} credits</strong>
            </div>
            <div>
              <span>Post regeneration</span>
              <strong>{plan.versionCredits.post} credits</strong>
            </div>
            {regen && <div>
              <span>Video regenerations this month</span>
              <strong>{Math.max(0, regen.cap - regen.used)} of {regen.cap} left · resets {new Date(regen.resetsAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',timeZone:'UTC'})}</strong>
            </div>}
            <div>
              <span>Text edit</span>
              <strong>Included</strong>
            </div>
          </div>
          <p className="hand">no mystery maths.</p>
        </section>
      </div>
      <div className="section-heading">
        <h2>Your creative trail</h2>
        <span className="muted">Credits, not provider charges</span>
      </div>
      {studio.ledger.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>Date</th>
                <th>Credits</th>
              </tr>
            </thead>
            <tbody>
              {studio.ledger.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.description}</strong>
                    <small>{l.kind}</small>
                  </td>
                  <td>
                    {new Date(l.created_at).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className={l.amount > 0 ? "credit-positive" : ""}>
                    {l.amount > 0 ? "+" : ""}
                    {l.amount === 0 ? "Included" : l.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={<ReceiptText />}
          title="A fresh start"
          description="Your credit activity will appear here."
        />
      )}
    </>
  );
}
export function SettingsPage() {
  const { studio } = useStudio();
  if (!studio) return null;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">BEHIND THE SCENES</span>
          <h1>
            Your{" "}
            <Highlight>
              <em>studio settings.</em>
            </Highlight>
          </h1>
          <p>A few useful details, all in one place.</p>
        </div>
      </div>
      <div className="settings-stack">
        <AccountDeletion enabled={Boolean(studio.accountDeletionEnabled)} />
        <UploadStorage key={`${studio.user.id}:${studio.user.workspaceId}`} />
        <section className="settings-card">
          <h2>
            <ShieldCheck size={20} />
            Your account
          </h2>
          <div>
            <span>Name</span>
            <strong>{studio.user.name}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{studio.user.email}</strong>
          </div>
          <div>
            <span>Workspace</span>
            <strong>{studio.brand.name}</strong>
          </div>
          <p>
            Your account uses managed sign-in and is connected to this private workspace.
          </p>
        </section>
        <section className="settings-card">
          <h2>
            <KeyRound size={20} />
            Generation connections
          </h2>
          <div>
            <span>Higgsfield</span>
            <span
              className={`pill ${studio.providers.higgsfield ? "connected" : ""}`}
            >
              {studio.providers.higgsfield
                ? "Credentials configured"
                : "Not connected"}
            </span>
          </div>
          <div>
            <span>Brand writing</span>
            <span className="pill">
              {studio.providers.claude
                ? "Credentials configured"
                : "Not connected"}
            </span>
          </div>
          <div>
            <span>Generation mode</span>
            <strong>
              {studio.mode === "mock"
                ? "Sample assets · no paid calls"
                : "Live"}
            </strong>
          </div>
          <p>
            {studio.mode === 'live' ? 'Creative generation uses server-side provider connections. Keys are never displayed here.' : 'This preview makes sample assets while live generation remains gated. Keys are configured on the server and never displayed here.'}
          </p>
        </section>
        <section className="settings-card">
          <h2>
            <Feather size={20} />
            {studio.mode === 'live' ? 'About your studio' : 'About this preview'}
          </h2>
          <p>
            {studio.mode === 'live' ? 'Your brand, campaigns and exports are saved in your private workspace.' : 'Your brand, campaigns and exports are saved in your private workspace. Sample videos are still-image clips using the duration shown in your campaign. They are not AI-generated motion.'}
          </p>
          {studio.mode !== 'live' ? <p>Live generation and payments remain in launch testing.</p> : null}
          <a
            className="text-link"
            href="https://docs.higgsfield.ai/docs"
            target="_blank"
            rel="noreferrer"
          >
            Higgsfield documentation
            <ExternalLink size={14} />
          </a>
        </section>
      </div>
    </>
  );
}

type StoredUpload = { id: string; sizeBytes: number | null; createdAt: string; inUse: boolean };
function UploadStorage() {
  const [uploads, setUploads] = useState<StoredUpload[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const epoch = useRef(0);
  async function refreshUploads() {
    const current = ++epoch.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ uploads: StoredUpload[] }>("/uploads");
      if (epoch.current === current) setUploads(result.uploads);
    } catch (e) {
      if (epoch.current === current) setError((e as Error).message);
    } finally {
      if (epoch.current === current) setLoading(false);
    }
  }
  useEffect(() => {
    void refreshUploads();
    return () => { epoch.current++; };
  }, []);
  async function removeUpload(upload: StoredUpload) {
    if (upload.inUse || deleting || !window.confirm("Permanently delete this unused upload? It cannot be restored. If it is selected in an unsaved brief, you will need to upload it again.")) return;
    setDeleting(upload.id);
    setError("");
    setMessage("");
    try {
      await api(`/uploads/${encodeURIComponent(upload.id)}`, undefined, "DELETE");
      setUploads(current => current?.filter(item => item.id !== upload.id) ?? null);
      setMessage("Unused upload deleted.");
      await refreshUploads();
    } catch (e) { setError((e as Error).message); }
    finally { setDeleting(""); }
  }
  const knownBytes = uploads?.reduce((sum, upload) => sum + (upload.sizeBytes ?? 0), 0) ?? 0;
  const unknownSizes = uploads?.some(upload => upload.sizeBytes === null);
  const size = (bytes: number | null) => bytes === null ? "Size not recorded" : `${(bytes / 1048576).toFixed(1)} MiB`;
  return <section className="settings-card upload-storage" aria-labelledby="upload-storage-heading">
    <h2 id="upload-storage-heading"><FolderOpen size={20} /> Your uploaded files</h2>
    <p>Each workspace can keep up to 100 uploads and 250 MiB of uploaded files. Remove unused files to make room. Files used by a saved brand or campaign are protected from deletion.</p>
    {uploads && <p><strong>{uploads.length} of 100 files · {unknownSizes ? "at least " : ""}{size(knownBytes)} of 250 MiB</strong></p>}
    <Button type="button" variant="secondary" busy={loading} disabled={!!deleting} onClick={() => void refreshUploads()}>Refresh files</Button>
    {error && <Notice>{error}</Notice>}
    {message && <p role="status">{message}</p>}
    {loading && uploads === null && <p role="status">Loading your uploads…</p>}
    {uploads?.length === 0 && <p>No uploaded files yet.</p>}
    {!!uploads?.length && <div className="table-wrap"><table>
      <thead><tr><th scope="col">Upload</th><th scope="col">Size</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
      <tbody>{uploads.map(upload => <tr key={upload.id}>
        <td><a href={`/api/uploads/${encodeURIComponent(upload.id)}`} target="_blank" rel="noopener noreferrer">View file <span className="sr-only">{upload.id.slice(-8)} (opens in a new tab)</span></a><small>{new Date(upload.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</small></td>
        <td>{size(upload.sizeBytes)}</td>
        <td>{upload.inUse ? "In use or processing" : "Unused"}</td>
        <td>{upload.inUse ? <span>Protected</span> : <Button type="button" variant="small secondary" busy={deleting === upload.id} disabled={!!deleting || loading} onClick={() => void removeUpload(upload)}>Delete<span className="sr-only"> unused file {upload.id.slice(-8)}</span></Button>}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
