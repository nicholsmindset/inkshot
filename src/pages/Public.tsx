import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ArrowRight,
} from "lucide-react";
import { BrandMark, Highlight, Button, Field, Notice } from "../ui";
import { CampaignExample } from "./CampaignExample";
import { api } from "../api";
import { useStudio } from "../context";
export function Landing() {
  const { refresh, studio } = useStudio();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [website, setWebsite] = useState("");
  const [publicStatus, setPublicStatus] = useState<{ billingMode: 'off' | 'sandbox' | 'live'; demoAvailable: boolean; mode?: 'mock' | 'live' }>({ billingMode: 'off', demoAvailable: false });
  useEffect(() => {
    void api<{ billingMode: 'off' | 'sandbox' | 'live'; demoAvailable: boolean; mode?: 'mock' | 'live' }>('/health').then(setPublicStatus).catch(() => {});
  }, []);
  function startWithWebsite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = website.trim();
    if (value) navigate(`${studio ? "/studio/brand" : "/signup"}?website=${encodeURIComponent(value)}`);
  }
  async function demo() {
    setBusy(true);
    try {
      await api("/auth/demo", {});
      await refresh({ fresh: true });
      navigate("/studio");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Link to="/">
          <BrandMark />
        </Link>
        <div className="landing-nav-center">
          <a href="#how">Example brief</a>
          <a href="#examples">Sample campaign</a>
          <a href="#pricing">Pricing</a>
          <a href="#questions">Questions</a>
        </div>
        <div>
          <Link className="text-link" to={studio ? "/studio" : "/login"}>
            {studio ? "Your studio" : "Log in"}
          </Link>
          <Link className="button" to={studio ? "/studio/brand" : "/signup"}>
            {studio ? "Edit my brief" : "Create a brand brief"} <ArrowUpRight size={16} />
          </Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <h1>
            Ad creative for{" "}
            <Highlight>
              <em>small businesses.</em>
            </Highlight>
          </h1>
          <p>
            Turn one offer into image ads, vertical video ads and social posts with captions.
            Explore a sample kit, then enter your website to start your own free campaign brief.
          </p>
          <label className="website-label" htmlFor="hero-website">Your business website</label>
          <form className="hero-website" onSubmit={startWithWebsite}>
            <input id="hero-website" type="text" inputMode="url" placeholder="yourbusiness.com" value={website} onChange={(e) => setWebsite(e.target.value)} required />
            <Button>Build my brief <ArrowUpRight size={17} /></Button>
          </form>
          {publicStatus.demoAvailable ? <div className="hero-actions">
            <Button variant="ghost" busy={busy} onClick={() => void demo()}>
              Explore a sample studio
            </Button>
          </div> : null}
          {error ? <Notice>{error}</Notice> : null}
          <div className="public-form-note">
            {studio ? "Opens in your brand workspace." : "Create a free account to review and save your brief."}
          </div>
        </div>
        <CampaignExample />
      </section>
      <section id="how" className="how-section" aria-labelledby="brief-heading">
        <div className="brief-intro">
          <h2 id="brief-heading">Your website becomes<br /><em>the creative brief.</em></h2>
          <p>Inkshot read Smart Calculator’s homepage and About page to build this profile. Review the details, then choose the offer you want to advertise.</p>
          <a className="brief-start" href="#hero-website">Start with my website <ArrowRight size={17} aria-hidden="true" /></a>
        </div>
        <article className="campaign-example brand-sheet" aria-label="Smart Calculator sample brand brief">
          <header className="example-heading">
            <span>Sample brand brief</span>
            <b>Smart Calculator</b>
          </header>
          <div className="brief-identity">
            <img src="/examples/smart-calculator-icon.svg" alt="Smart Calculator’s red SG site icon" width="68" height="68" />
            <div>
              <span>smartcalculator.sg</span>
              <h3>Smart Calculator</h3>
            </div>
          </div>
          <div className="brief-facts">
            <div>
              <h4>What it offers</h4>
              <p>Free Singapore calculators for CPF, tax, housing and everyday decisions.</p>
            </div>
            <div className="brief-palette">
              <h4>Brand colour</h4>
              <p><span className="brand-chip" aria-hidden="true" /><code>#B7102A</code></p>
            </div>
          </div>
          <footer className="brief-provenance">
            <span>Imported from</span>
            <strong>Homepage &amp; About page</strong>
          </footer>
        </article>
      </section>
      <section id="pricing" className="pricing-section">
        <div>
          <h2>{publicStatus.billingMode === "live" ? "Studio pricing" : "Planned Studio pricing"}</h2>
          <p>Import your site and review your brand brief for free.
            Each nine-asset kit uses 100 credits when you approve it.</p>
        </div>
        <div className="pricing-card">
          <div className="pricing-title">
            <span>Studio</span>
  
          </div>
          <div className="price">
            $39 <small>USD / month</small>
          </div>
          <p>Enough credits for three complete kits.</p>
          <ul>
            {[
              "300 generation credits each month",
              "3 videos, 3 images and 3 posts per kit",
              "Headline edits included",
              "Version history and finished downloads",
              "Extra generation uses credits shown before approval",
            ].map((t) => (
              <li key={t}>
                <Check size={16} />
                {t}
              </li>
            ))}
          </ul>
          <Link to={studio ? "/studio/brand" : "/signup"} className="button full">
            {studio ? "Open my brand brief" : "Create a free brief"} <ArrowUpRight size={16} />
          </Link>
          <small className="muted">
            {publicStatus.billingMode === 'live' ? 'Secure checkout is available after you create your studio.' : publicStatus.billingMode === 'sandbox' ? 'Preview checkout uses test payments. No real subscription charge.' : 'Checkout is not available yet.'}
          </small>
        </div>
      </section>
      <section id="questions" className="questions-section">
        <h2>Before you begin.</h2>
        <div className="question-list">
          <details><summary>Do you need access to my website account?</summary><p>No. Inkshot reads public pages from the URL you provide. You can edit the brief and upload your own photos.</p></details>
          <details><summary>Can I change the words before making ads?</summary><p>Yes. Review your brand brief and campaign ideas before generation. Headline edits to finished assets do not use generation credits.</p></details>
          <details><summary>What happens if an asset fails?</summary><p>Successful assets remain available. Credits for an asset that could not be completed are returned to your workspace.</p></details>
          <details><summary>How are generation credits used?</summary><p>One nine-asset kit uses 100 credits. The Studio plan includes 300 monthly credits. We show the credit cost before you approve generation.</p></details>
        </div>
      </section>
      <footer className="landing-footer">
        <BrandMark />
        <span>© {new Date().getFullYear()} Inkshot</span>
      </footer>
    </div>
  );
}
export function Auth({ signup = false }: { signup?: boolean }) {
  const { refresh, studio } = useStudio();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [email, setEmail] = useState("");
  const [confirmationHelp, setConfirmationHelp] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [searchParams] = useSearchParams();
  const requestedWebsite = searchParams.get("website");
  const websiteQuery = requestedWebsite ? `?website=${encodeURIComponent(requestedWebsite)}` : "";
  const studioDestination = signup || requestedWebsite ? `/studio/brand${websiteQuery}` : "/studio";
  useEffect(() => {
    if (!resendSeconds) return;
    const timer = window.setTimeout(() => setResendSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);
  async function resendConfirmation(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    if (busy || resendSeconds > 0) return;
    setBusy(true);
    setError("");
    setConfirmationMessage("");
    const address = (confirmationEmail || email).trim().toLowerCase();
    try {
      await api("/auth/resend-confirmation", { email: address });
      setConfirmationEmail(address);
      setConfirmationMessage("If this address has an account awaiting confirmation, a new email is on its way. Check your inbox and spam folder.");
      setResendSeconds(60);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verifyEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const token = String(new FormData(e.currentTarget).get("token") || "").trim();
    try {
      await api("/auth/verify-email", { email: confirmationEmail, token });
      await refresh({ fresh: true });
      navigate(studioDestination, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function editEmail() {
    setEmail(confirmationEmail);
    setConfirmationEmail("");
    setConfirmationMessage("");
    setError("");
    // A different signup is a new attempt, not an update to an existing account.
    if (signup) setConfirmationHelp(false);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api<{confirmationRequired?:boolean}>(
        `/auth/${signup ? "signup" : "login"}`,
        { ...Object.fromEntries(form), ...(signup && requestedWebsite ? { website: requestedWebsite } : {}) },
      );
      if(result.confirmationRequired) {
        setConfirmationEmail(String(form.get('email') || '').trim().toLowerCase());
        setConfirmationMessage("If your account needs confirmation, check your inbox and spam folder for an email from Inkshot.");
        setResendSeconds(60);
        return;
      }
      await refresh({ fresh: true });
      navigate(studioDestination, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (studio && !busy) return <Navigate to={studioDestination} replace />;
  return (
    <div className="auth-page">
      <div className="auth-form">
        <Link to="/">
          <BrandMark />
        </Link>
        <div>
          <h1>
            {signup
              ? "Create your brand brief"
              : "Sign in to Inkshot"}
          </h1>
          <p className="muted">
            {signup
              ? (requestedWebsite ? `Create an account to import ${requestedWebsite} and review the draft.` : "Create an account, then add your website to start your brief.")
              : "Sign in and pick up where you left off."}
          </p>
          {!signup && searchParams.get("confirmation") === "failed" && <Notice>The confirmation link could not be used. It may have expired or been opened in another browser. Try signing in, or open the latest confirmation email in the browser where you signed up.</Notice>}
          {confirmationEmail ? <div className="auth-confirmation">
            <h2>Check your email</h2>
            <p className="confirmation-address">{confirmationEmail}</p>
            {confirmationMessage && <p role="status">{confirmationMessage}</p>}
            <p>Open the confirmation link in the browser where you requested it. If the email includes a code, you can enter it here on any device.</p>
            <form onSubmit={verifyEmail}>
              <Field label="Email confirmation code" hint="Enter the 6–10 digit code from your latest confirmation email, if shown.">
                <input name="token" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required disabled={busy} />
              </Field>
              <Button className="full" busy={busy}>Confirm my email</Button>
            </form>
            {error ? <Notice>{error}</Notice> : null}
            <Button type="button" variant="secondary" className="full" disabled={busy || resendSeconds > 0} onClick={() => void resendConfirmation()}>
              {resendSeconds > 0 ? `Resend available in ${resendSeconds}s` : "Resend confirmation email"}
            </Button>
            <Button type="button" variant="ghost" className="full" disabled={busy} onClick={editEmail}>Use a different email</Button>
            {signup && <small>This starts a new signup. It does not change an existing account’s email.</small>}
            {signup ? <Link className="button full secondary" to={`/login${websiteQuery}`}>Go to sign in</Link> : <Button type="button" variant="ghost" className="full" disabled={busy} onClick={() => { setConfirmationEmail(""); setConfirmationHelp(false); setConfirmationMessage(""); setError(""); }}>Back to sign in</Button>}
          </div> : confirmationHelp ? <div className="auth-confirmation">
            <h2>Confirm your email</h2>
            <p>Enter the email you used to create your account. You can also enter a code from a confirmation email you already received.</p>
            <form onSubmit={resendConfirmation}>
              <Field label="Email address"><input name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required disabled={busy} /></Field>
              {error ? <Notice>{error}</Notice> : null}
              <Button className="full" busy={busy} disabled={resendSeconds > 0}>{resendSeconds > 0 ? `Resend available in ${resendSeconds}s` : "Send confirmation email"}</Button>
              <Button type="button" variant="secondary" className="full" disabled={busy} onClick={e => {
                const form = e.currentTarget.form;
                if (!form?.reportValidity()) return;
                setConfirmationEmail(email.trim().toLowerCase()); setError(""); setConfirmationMessage("");
              }}>I already have a code</Button>
            </form>
            <Button type="button" variant="ghost" className="full" disabled={busy} onClick={() => { setConfirmationHelp(false); setError(""); }}>Back to sign in</Button>
          </div> : <form onSubmit={submit}>
            {signup ? (
              <Field label="Your name">
                <input
                  name="name"
                  disabled={busy}
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </Field>
            ) : null}
            <Field label="Email address">
              <input name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required disabled={busy} />
            </Field>
            <Field
              label="Password"
              hint={signup ? "At least 12 characters." : ""}
            >
              <input
                name="password"
                disabled={busy}
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={signup ? 12 : 1}
                maxLength={128}
                required
              />
            </Field>
            {error ? <Notice>{error}</Notice> : null}
            <Button className="full" busy={busy}>
              {signup ? "Create my studio" : "Open my studio"}
              <ArrowRight size={16} />
            </Button>
          </form>}
          {!signup && <p className="auth-switch"><Link to="/forgot-password">Forgot your password?</Link></p>}
          {!signup && !confirmationHelp && !confirmationEmail && <p className="auth-switch"><button type="button" className="auth-text-button" disabled={busy} onClick={() => { setConfirmationHelp(true); setError(""); }}>Need a confirmation email?</button></p>}
          <p className="auth-switch">
            {signup ? "Already have a studio?" : "New around here?"}{" "}
            <Link to={`${signup ? "/login" : "/signup"}${websiteQuery}`}>
              {signup ? "Log in" : "Create an account"}
            </Link>
          </p>
          <small className="muted">
            You can create an account and review a brand brief before subscribing.
          </small>
        </div>
      </div>
      <aside className="auth-example">
        <div>
          <h2>One offer, three formats.</h2>
          <p>Explore the image, video and social post made from this fictional bakery brief.</p>
        </div>
        <CampaignExample />
      </aside>
    </div>
  );
}
