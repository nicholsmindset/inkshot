import {useState} from "react";
import {api} from "../api";
import {
  Check,
  Feather,
  ReceiptText,
  ShieldCheck,
  KeyRound,
  ExternalLink,
} from "lucide-react";
import { useStudio } from "../context";
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
  const canSubscribe = ["none", "canceled", "incomplete_expired"].includes(studio.billingStatus);
  const live = studio.billingMode === "live";
  let billingLabel = live ? "Manage subscription" : "Manage test subscription";
  if (canSubscribe) billingLabel = live ? "Subscribe for US$39/month" : "Test subscription checkout";
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
            $39 <small>USD / month</small>
          </div>
          <p>One small business. Three complete campaigns.</p>
          <ul>
            {[
              "Each monthly payment tops your balance up to 300 credits",
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
          <Button className="full" disabled={!studio.billingEnabled} busy={busy} onClick={()=>openBilling(canSubscribe ? 'checkout' : 'portal')}>
            {studio.billingEnabled ? billingLabel : 'Checkout is not configured yet'}
          </Button>
          <small>{studio.billingMode === 'live' ? 'Renews monthly. Cancel in the billing portal to end your subscription at the end of the billing period.' : 'Stripe sandbox only. No real payment is collected.'}</small>
        </section>
        <section className="balance-panel">
          <Feather size={25} />
          <span className="eyebrow">READY WHEN YOU ARE</span>
          <h2>
            <Highlight>{studio.balance}</Highlight>
          </h2>
          <p>{studio.billingMode === 'live' ? 'credits available' : 'preview credits available'}</p>
          <div className="credit-track">
            <i style={{ width: `${Math.min(100, studio.balance / 3)}%` }} />
          </div>
          <div className="credit-explainer">
            <div>
              <span>Complete kit</span>
              <strong>100 credits</strong>
            </div>
            <div>
              <span>Video regeneration</span>
              <strong>26 credits</strong>
            </div>
            <div>
              <span>Image regeneration</span>
              <strong>5 credits</strong>
            </div>
            <div>
              <span>Post regeneration</span>
              <strong>2 credits</strong>
            </div>
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
            {studio.mode === 'live' ? 'Your brand, campaigns and exports are saved in your private workspace.' : 'Your brand, campaigns and exports are saved in your private workspace. Sample video exports use a still image for five seconds; they are not AI-generated motion.'}
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
