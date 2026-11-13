import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Film,
  Image,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import { BrandMark, Highlight, Button, Field, Notice } from "../ui";
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
      await refresh();
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
          <a href="#examples">What you get</a>
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
            Turn your website into{" "}
            <Highlight>
              <em>an ad brief.</em>
            </Highlight>
          </h1>
          <p>
            Enter your business website. Inkshot reads up to four public pages
            and drafts a description you can edit. Add the offer you want to
            promote, then review three campaign ideas.
          </p>
          <form className="hero-website" onSubmit={startWithWebsite}>
            <label className="sr-only" htmlFor="hero-website">Your business website</label>
            <input id="hero-website" type="text" inputMode="url" placeholder="yourbusiness.com" value={website} onChange={(e) => setWebsite(e.target.value)} required />
            <Button>Build my brief <ArrowUpRight size={17} /></Button>
          </form>
          {publicStatus.demoAvailable ? <div className="hero-actions">
            <Button variant="ghost" busy={busy} onClick={() => void demo()}>
              Explore a sample studio
            </Button>
          </div> : null}
          {error ? <Notice>{error}</Notice> : null}
          <div className="hero-note hand">
            {studio ? "Opens in your brand workspace." : "Create a free account to review and save your brief."}
          </div>
          <div className="hero-formats">
            <span>
              <Film size={15} />3 video ads
            </span>
            <span>
              <Image size={15} />3 image ads
            </span>
            <span>
              <MessageSquare size={15} />3 posts
            </span>
          </div>
        </div>
        <div
          className="hero-art"
          aria-label="Sample ad campaign for the fictional Lumen and Ledger candle studio"
        >
          <span className="hand art-note">Sample candle campaign</span>
          <div className="sample-card sample-back">
            <img
              src="/examples/candle.png"
              alt="Ivory ceramic candle beside linen and an olive branch"
            />
            <div>
              <span>LUMEN & LEDGER</span>
              <h3>
                Good things.
                <br />
                Thoughtfully made.
              </h3>
            </div>
            <small>Sample image ad</small>
          </div>
          <div className="sample-card sample-front">
            <img src="/examples/candle.png" alt="Sample candle campaign" />
            <div>
              <span>LUMEN & LEDGER</span>
              <h3>
                Make room
                <br />
                for slow.
              </h3>
            </div>
            <small>Video concept · sample</small>
          </div>
          <div className="floating-note">
            <Image size={17} />
            <div>
              One candle, two headlines
              <small>Fictional studio · sample artwork</small>
            </div>
          </div>
        </div>
      </section>
      <section id="examples" className="format-section">
        <h2>Inside a nine-asset campaign kit</h2>
        <div className="format-grid">
          <article><Film size={20} /><h3>Paid video ads</h3><p>{publicStatus.mode === "live" ? "Three short vertical videos for a campaign." : "Three five-second MP4 samples made from still images."}</p><span>03 videos</span></article>
          <article><Image size={20} /><h3>Paid image ads</h3><p>Three images with a headline and call to action included in each download.</p><span>03 images</span></article>
          <article><MessageSquare size={20} /><h3>Organic posts</h3><p>Three images with matching captions in the kit download.</p><span>03 posts</span></article>
        </div>
      </section>
      <section id="how" className="how-section">
        <h2>What Inkshot found on a real website</h2>
        <p>Example from <a href="https://www.smartcalculator.sg/">Smart Calculator</a> and its <a href="https://www.smartcalculator.sg/about">About page</a>.</p>
        <div className="steps-grid">
          {[
            [
              "01",
              "Two pages, one business",
              "For Smart Calculator, Inkshot read the homepage and About page. It identified a Singapore business offering free CPF, tax and housing calculators.",
            ],
            [
              "02",
              "A colour and a logo reference",
              "The import found the site’s red theme colour (#b7102a) and its icon. Both appear in the brief so the owner can check whether they belong in the brand profile.",
            ],
            [
              "03",
              "A brief the owner can check",
              "The owner can open the source pages, correct the description and save the brief for the next campaign. You can do the same with your site.",
            ],
          ].map(([n, title, text]) => (
            <div key={n}>
              <span className="step-number hand">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
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
            <span className="pill">For your small business</span>
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
  const { refresh } = useStudio();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchParams] = useSearchParams();
  const requestedWebsite = searchParams.get("website");
  const websiteQuery = requestedWebsite ? `?website=${encodeURIComponent(requestedWebsite)}` : "";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api<{confirmationRequired?:boolean}>(
        `/auth/${signup ? "signup" : "login"}`,
        Object.fromEntries(form),
      );
      if(result.confirmationRequired) {
        setError('Check your email to confirm your account, then sign in.');
        return;
      }
      await refresh();
      navigate(signup || requestedWebsite ? `/studio/brand${websiteQuery}` : "/studio");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
          <form onSubmit={submit}>
            {signup ? (
              <Field label="Your name">
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </Field>
            ) : null}
            <Field label="Email address">
              <input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field
              label="Password"
              hint={signup ? "At least 12 characters." : ""}
            >
              <input
                name="password"
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
          </form>
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
      <div className="auth-image">
        <img
          src="/examples/candle.png"
          alt="A candle in warm afternoon sunlight"
        />
        <div>
          <span className="hand">Sample campaign</span>
          <h2>Lumen &amp; Ledger candle studio</h2>
        </div>
      </div>
    </div>
  );
}
