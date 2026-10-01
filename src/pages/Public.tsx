import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Play,
  Check,
  Film,
  Image,
  MessageSquare,
  ArrowRight,
  Feather,
} from "lucide-react";
import { BrandMark, Highlight, Button, Field, Notice } from "../ui";
import { api } from "../api";
import { useStudio } from "../context";
export function Landing() {
  const { refresh, studio } = useStudio();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div>
          <Link className="text-link" to={studio ? "/studio" : "/login"}>
            {studio ? "Your studio" : "Log in"}
          </Link>
          <Link className="button" to="/signup">
            Create your studio <ArrowUpRight size={16} />
          </Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Feather size={15} /> A SMALL BUSINESS CREATIVE STUDIO
          </span>
          <h1>
            Your website in.
            <br />A week of{" "}
            <Highlight>
              <em>ads out.</em>
            </Highlight>
          </h1>
          <p>
            You’ve got a business to run. Turn what makes it special into
            videos, images and posts worth sharing.
          </p>
          <div className="hero-actions">
            <Link className="button large" to="/signup">
              Make something good <ArrowUpRight size={18} />
            </Link>
            <Button variant="ghost" busy={busy} onClick={() => void demo()}>
              Explore the sample studio
            </Button>
          </div>
          {error ? <Notice>{error}</Notice> : null}
          <div className="hero-note hand">
            your next campaign starts here <span>↗</span>
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
          <span className="hand art-note">a little less blank page.</span>
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
            <i className="play-circle">
              <Play size={22} fill="currentColor" />
            </i>
            <small>Video concept · sample</small>
          </div>
          <div className="floating-note">
            <Check size={17} />
            <div>
              One brand. Nine possibilities.
              <small>Made to feel like you.</small>
            </div>
          </div>
        </div>
      </section>
      <section id="how" className="how-section">
        <div className="section-label">A SIMPLE LITTLE PROCESS</div>
        <h2>
          From “where do I start?”
          <br />
          to <em>“that’s so us.”</em>
        </h2>
        <div className="steps-grid">
          {[
            [
              "01",
              "Start with your story",
              "Add your website and a few photos. We’ll help turn them into a brand brief you can make your own.",
            ],
            [
              "02",
              "Find your angle",
              "Choose your goal, check the concepts and approve the words before anything gets made.",
            ],
            [
              "03",
              "Make it yours",
              "Create your kit, refine what needs a little love and download ads with your brand built in.",
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
          <span className="eyebrow">LESS GUESSWORK. MORE MAKING.</span>
          <h2>
            A small studio.
            <br />
            <em>A little every month.</em>
          </h2>
          <p>
            One straightforward plan. Generation has a limit.
            <br />
            Your ideas don’t have to.
          </p>
        </div>
        <div className="pricing-card">
          <div className="pricing-title">
            <span>Studio</span>
            <span className="pill">For your small business</span>
          </div>
          <div className="price">
            $39 <small>USD / month</small>
          </div>
          <p>Three complete kits. Twenty-seven assets.</p>
          <ul>
            {[
              "300 generation credits each month",
              "3 videos, 3 images and 3 posts per kit",
              "Text and layout edits included",
              "Version history and finished downloads",
              "Additional generation via paid top-ups",
            ].map((t) => (
              <li key={t}>
                <Check size={16} />
                {t}
              </li>
            ))}
          </ul>
          <Link to="/signup" className="button full">
            Create your studio <ArrowUpRight size={16} />
          </Link>
          <small className="muted">
            Early preview. Checkout is not active yet.
          </small>
        </div>
      </section>
      <footer className="landing-footer">
        <BrandMark />
        <span>A thoughtful little studio for your next big idea.</span>
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
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api(
        `/auth/${signup ? "signup" : "login"}`,
        Object.fromEntries(form),
      );
      await refresh();
      navigate(signup ? "/studio/brand" : "/studio");
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
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h1>
            {signup
              ? "A little space\nto create."
              : "Back for\nsomething good."}
          </h1>
          <p className="muted">
            {signup
              ? "Create your account. Let’s make your business look like itself."
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
            <Link to={signup ? "/login" : "/signup"}>
              {signup ? "Log in" : "Create an account"}
            </Link>
          </p>
          <small className="muted">
            Preview access includes sample credits. No card or payment required.
          </small>
        </div>
        <span className="muted">A thoughtful little studio by Inkshot.</span>
      </div>
      <div className="auth-image">
        <img
          src="/examples/candle.png"
          alt="A candle in warm afternoon sunlight"
        />
        <div>
          <span className="hand">make something worth sharing.</span>
          <h2>
            More you.
            <br />
            Less blank page.
          </h2>
        </div>
      </div>
    </div>
  );
}
