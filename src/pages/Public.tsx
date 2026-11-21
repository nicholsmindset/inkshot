import { TrustLinks } from "./Trust";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ArrowRight,
} from "lucide-react";
import { BrandMark, Highlight, Button, Field, Notice } from "../ui";
import { WorkflowDemo } from "./WorkflowDemo";
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
    <div className="landing landing-premium">
      <nav className="landing-nav">
        <Link to="/">
          <BrandMark />
        </Link>
        <div className="landing-nav-center">
          <a href="#workflow">How it works</a>
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
          <div className="home-eyebrow"><span /> YOUR SMALL BUSINESS. YOUR CREATIVE STUDIO.</div>
          <h1>
            Your next offer.{" "}
            <Highlight>
              <em>A whole campaign.</em>
            </Highlight>
          </h1>
          <p>
            Turn your website and product photos into image ads, vertical videos and social posts. One brief. A consistent look. Copy you can make your own.
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
        <div className="hero-demo"><div className="demo-caption"><span>FROM A SINGLE OFFER</span><span>Try the formats below ↙</span></div><CampaignExample /><p className="demo-disclosure">Fictional bakery campaign · Downloadable samples · Video is a still preview</p></div>
      </section>
      <div className="deliverable-strip" aria-label="What is in a campaign kit"><span>ONE CAMPAIGN KIT</span><strong>3 video ads</strong><span aria-hidden="true">+</span><strong>3 image ads</strong><span aria-hidden="true">+</span><strong>3 social posts</strong><span className="strip-note">Captions included. Yours to review.</span></div>
      <WorkflowDemo />
      <section id="how" className="how-section" aria-labelledby="brief-heading">
        <div className="brief-intro">
          <span className="home-eyebrow">A BRIEF WITH YOUR BUSINESS IN IT</span>
          <h2 id="brief-heading">Your product.<br /><em>The starting point.</em></h2>
          <p>A good campaign starts with a clear offer. Keep your product, audience and brand details together, then review the creative direction before making ads.</p>
          <p className="brief-example-note">Meet June Bakery: our fictional example of a weekend shortcake campaign.</p>
          <a className="brief-start" href="#hero-website">Start with my website <ArrowRight size={17} aria-hidden="true" /></a>
        </div>
        <article className="campaign-example brand-sheet bakery-brief" aria-label="June Bakery fictional campaign brief">
          <header className="example-heading"><span>THE CAMPAIGN BRIEF</span><b>Sample · June Bakery</b></header>
          <div className="bakery-brief-product"><img src="/examples/strawberry-cake.webp" alt="Strawberry shortcake used in the June Bakery sample campaign" width="180" height="180" loading="lazy" /><div><span>JUNE BAKERY</span><h3>A little celebration,<br />made from scratch.</h3><p>Fresh strawberries. Vanilla sponge. Weekend plans, sorted.</p></div></div>
          <dl className="bakery-brief-details"><div><dt>The offer</dt><dd>Weekend strawberry shortcakes.<br />Pre-order by Friday.</dd></div><div><dt>The audience</dt><dd>Local customers planning a birthday, a gathering or a weekend treat.</dd></div><div><dt>The voice</dt><dd><span className="voice-tag">Warm</span><span className="voice-tag">Simple</span><span className="voice-tag">Celebratory</span></dd></div><div><dt>The palette</dt><dd className="bakery-swatches"><span style={{background:'#29483d'}} aria-label="Forest green" /><span style={{background:'#f4eee2'}} aria-label="Cream" /><span style={{background:'#b34d42'}} aria-label="Strawberry red" /><span>Inspired by the sample</span></dd></div></dl>
          <footer className="brief-provenance"><Check size={16} aria-hidden="true" /><span>You review the details before generation.</span></footer>
        </article>
      </section>
      <section className="home-output" aria-labelledby="output-heading">
        <div className="home-section-heading"><div><span className="home-eyebrow">ONE OFFER. DIFFERENT WAYS TO TELL IT.</span><h2 id="output-heading">A campaign that<br /><em>looks like it belongs together.</em></h2></div><a href="#examples" className="brief-start">Try the sample downloads <ArrowRight size={17} /></a></div>
        <div className="home-output-grid">
          <figure><div className="output-image"><img src="/examples/bakery-image.jpg" width="1080" height="1350" loading="lazy" alt="Portrait strawberry shortcake image ad for June Bakery" /></div><figcaption><span>01 / IMAGE ADS</span><h3>Put your offer in focus.</h3><p>Product-led visuals with a headline and a clear next step.</p></figcaption></figure>
          <figure><div className="output-image output-video"><img src="/examples/bakery-poster.webp" width="1080" height="1920" loading="lazy" alt="Vertical bakery video sample poster" /><a href="#examples" aria-label="Explore the bakery video sample">Explore video sample <ArrowUpRight size={16} /></a></div><figcaption><span>02 / VERTICAL VIDEO</span><h3>Give your story a little room.</h3><p>Portrait video creatives. The demo above is a five-second still preview.</p></figcaption></figure>
          <figure><div className="output-image output-social"><img src="/examples/bakery-post.jpg" width="1080" height="1080" loading="lazy" alt="Square June Bakery social post featuring a strawberry shortcake" /></div><figcaption><span>03 / SOCIAL POSTS</span><h3>Keep the conversation going.</h3><p>Feed-ready images and editable captions for your own channels.</p></figcaption></figure>
        </div>
      </section>
      <section className="home-control" aria-labelledby="control-heading"><div><span className="home-eyebrow">AI MAKES THE DRAFT. YOU MAKE THE CALL.</span><h2 id="control-heading">Your brand deserves<br /><em>the final say.</em></h2><p>Inkshot helps you create advertising assets. You decide what is accurate, what feels right and what gets published.</p></div><ul><li><Check /><div><h3>Approve before generation</h3><p>See the brief, prompts and credit cost before you commit.</p></div></li><li><Check /><div><h3>Keep your product recognisable</h3><p>Bring your own product photo and check the result before downloading.</p></div></li><li><Check /><div><h3>Refine without starting over</h3><p>Edit headlines and captions, keep version history and review the latest creative.</p></div></li></ul></section>
      <section id="pricing" className="pricing-section">
        <div>
          <span className="home-eyebrow">START WITH THE BRIEF</span>
          <h2>See the direction.<br /><em>Then make the campaign.</em></h2>
          <p>Import your site and review your brand brief for free.
            Each nine-asset kit uses 100 credits when you approve it.</p>
          <div className="free-brief-note"><Check size={20} /><div><strong>Your brand brief is free.</strong><p>Create an account, bring your website and review the details before subscribing.</p></div></div>
        </div>
        <div className="pricing-card">
          <div className="pricing-title">
            <span>Studio</span><span className="plan-status">{publicStatus.billingMode === "live" ? "Monthly plan" : "Planned pricing"}</span>
  
          </div>
          <div className="price">
            $39 <small>USD / month</small>
          </div>
          <p>Enough credits for three complete kits.</p>
          <ul>
            {[
              "Each monthly payment tops your balance up to 300 credits",
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
        <span className="home-eyebrow">A FEW THINGS WORTH KNOWING</span><h2>Before you begin.</h2>
        <div className="question-list">
          <details><summary>Will Inkshot run my advertising campaigns?</summary><p>Inkshot creates creative assets for you to review and download. You publish them through your own social or advertising accounts. Media buying and guaranteed campaign results are not included.</p></details>
          <details><summary>Do you need access to my website account?</summary><p>No. Inkshot reads public pages from the URL you provide. You can edit the brief and upload your own photos.</p></details>
          <details><summary>Can I change the words before making ads?</summary><p>Yes. Review your brand brief and campaign ideas before generation. Headline edits to finished assets do not use generation credits.</p></details>
          <details><summary>What happens if an asset fails?</summary><p>Successful assets remain available. Credits for an asset that could not be completed are returned to your workspace.</p></details>
          <details><summary>How are generation credits used?</summary><p>One nine-asset kit uses 100 credits. The Studio plan includes 300 monthly credits. We show the credit cost before you approve generation.</p></details>
        </div>
      </section>
      <section className="home-closing"><span className="home-eyebrow">YOUR NEXT CAMPAIGN STARTS HERE</span><h2>Something worth selling.<br /><em>Now give it something worth seeing.</em></h2><a href="#hero-website" className="button">Build my free brief <ArrowUpRight size={17} /></a><p>Start with your website. Keep control of the creative.</p></section>
      <footer className="landing-footer">
        <TrustLinks />
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
          <div className="auth-policies">Review how Inkshot handles your work and what to check before publishing.<TrustLinks /></div>
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
