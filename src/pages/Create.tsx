import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Link as LinkIcon,
  ArrowUpRight,
  Upload,
  Check,
  Feather,
  ArrowLeft,
} from "lucide-react";
import { useStudio } from "../context";
import { api } from "../api";
import { Button, Field, Highlight, Notice } from "../ui";
import type { Brand } from "../../shared/types";
export function BrandPage() {
  const { studio } = useStudio();
  return studio ? (
    <BrandForm key={studio.user.id} initial={studio.brand} />
  ) : null;
}
function BrandForm({ initial }: { initial: Brand }) {
  const { studio, refresh, notify } = useStudio();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedWebsite = searchParams.get("website");
  const startedWebsiteRead = useRef(false);
  const [brand, setBrand] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [url, setUrl] = useState(searchParams.get("website") || initial.website);
  const set = (key: keyof Brand, value: unknown) =>
    setBrand((b) => ({ ...b, [key]: value }));
  async function read(requestedUrl = url) {
    setBusy("read");
    setError("");
    try {
      let address = requestedUrl.trim();
      if (!address.startsWith("https://")) address = `https://${address}`;
      const next = await api<Brand>("/brand/read", { url: address });
      setBrand({
        ...next,
        ...(brand.photoId ? { photoId: brand.photoId } : {}),
      });
      notify(
        studio?.mode === "mock"
          ? "Website text imported. Review and refine your brief below."
          : "Your brand brief is ready to review.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (!requestedWebsite || startedWebsiteRead.current) return;
    startedWebsiteRead.current = true;
    void read(requestedWebsite).finally(() => setSearchParams({}, { replace: true }));
  }, [requestedWebsite, setSearchParams]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError("");
    try {
      await api("/brand", brand, "PUT");
      await refresh();
      notify("Your brand brief has been saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy("upload");
    setError("");
    try {
      const data = new FormData();
      data.append("photo", file);
      const result = await api<{ id: string }>("/uploads", data);
      set("photoId", result.id);
      notify("Photo added. Save your brief to keep it.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="journey-steps" aria-label="Campaign setup progress">
        <span className="active">01 Your site</span><span>02 Your brief</span><span>03 Your kit</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE HEART OF EVERYTHING YOU MAKE</span>
          <h1>
            Unmistakably{" "}
            <Highlight>
              <em>you.</em>
            </Highlight>
          </h1>
          <p>A few thoughtful details make a world of difference.</p>
        </div>
        <Link to="/studio/new" className="button secondary">
          New campaign
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="brand-layout">
        <div>
          <div className="website-reader">
            <div>
              <LinkIcon size={19} />
              <h3>Start with your website</h3>
            </div>
            <p>
              We’ll read up to four public pages. You can change everything
              below.
            </p>
            <div className="input-button">
              <input
                type="text"
                aria-label="Your website"
                placeholder="yourbusiness.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button
                disabled={!url.trim() || !!busy}
                busy={busy === "read"}
                onClick={() => void read()}
              >
                Read my site
              </Button>
            </div>
            {busy === "read" ? <p className="read-progress" role="status"><span className="read-spinner" /> Reading public pages and preparing your editable brief…</p> : null}
            {!busy && brand.website ? <p className="read-progress read-complete"><Check size={16} /> Site read. Check every fact and offer before saving.</p> : null}
            {studio?.mode === "mock" ? (
              <small>
                Preview mode imports page text for you to refine. AI brief
                writing is not active.
              </small>
            ) : null}
          </div>
          <form className="brand-form" onSubmit={save}>
            <div className="form-section-heading">
              <span className="hand">01</span>
              <h2>Your story</h2>
            </div>
            <Field label="Business name">
              <input
                required
                value={brand.name}
                onChange={(e) => set("name", e.target.value)}
                maxLength={100}
              />
            </Field>
            <Field
              label="What do you do?"
              hint="A clear description of what you sell and what makes it special."
            >
              <textarea
                rows={4}
                required
                value={brand.description}
                onChange={(e) => set("description", e.target.value)}
                maxLength={4000}
              />
            </Field>
            <Field label="Who is it for?">
              <textarea
                rows={2}
                value={brand.audience}
                onChange={(e) => set("audience", e.target.value)}
                maxLength={1000}
              />
            </Field>
            <div className="form-section-heading">
              <span className="hand">02</span>
              <h2>Your personality</h2>
            </div>
            <Field label="How should your brand sound?">
              <input
                value={brand.voice}
                onChange={(e) => set("voice", e.target.value)}
                placeholder="Warm, thoughtful, a little playful"
                maxLength={300}
              />
            </Field>
            <div className="voice-chips">
              {[
                "Warm & thoughtful",
                "Bold & confident",
                "Friendly & playful",
                "Calm & considered",
              ].map((voice) => (
                <button
                  type="button"
                  key={voice}
                  onClick={() => set("voice", voice)}
                >
                  {voice}
                </button>
              ))}
            </div>
            <Field
              label="Your offer"
              hint="Only include an offer you can honour. Leave blank if you don’t have one."
            >
              <input
                value={brand.offer}
                onChange={(e) => set("offer", e.target.value)}
                maxLength={500}
              />
            </Field>
            <Field
              label="Facts we can use"
              hint="One verified fact per line. No need to make anything up."
            >
              <textarea
                rows={3}
                value={brand.proof.join("\n")}
                onChange={(e) =>
                  set("proof", e.target.value.split("\n").slice(0, 12))
                }
              />
            </Field>
            <Field label="Brand colour">
              <div className="color-field">
                <input
                  type="color"
                  value={brand.color}
                  onChange={(e) => set("color", e.target.value)}
                />
                <code>{brand.color}</code>
                <small>Saved with your brand for future templates</small>
              </div>
            </Field>
            {error ? <Notice>{error}</Notice> : null}
            <div className="form-actions">
              <span className="muted">
                Your brand goes with every campaign.
              </span>
              <Button busy={busy === "save"} disabled={!!busy}>
                <Check size={17} />
                Save my brand
              </Button>
            </div>
          </form>
        </div>
        <aside className="brand-aside">
          <div className="photo-upload">
            {brand.photoId ? (
              <img
                src={`/api/uploads/${brand.photoId}`}
                alt="Your uploaded brand photo"
              />
            ) : (
              <div className="upload-empty">
                <Upload size={28} />
                <h3>A picture of your world.</h3>
                <p>
                  Add a product, space or service photo to make your samples
                  feel more like you.
                </p>
              </div>
            )}
            <label
              className={`button secondary full ${busy ? "disabled" : ""}`}
            >
              <Upload size={16} />
              {busy === "upload"
                ? "Adding your photo…"
                : brand.photoId
                  ? "Change photo"
                  : "Add a brand photo"}
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={!!busy}
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </label>
            <small>
              JPG, PNG or WebP · up to 10 MB
              <br />
              Use a photo you have permission to use.
            </small>
          </div>
          <div className="margin-note">
            <Feather size={22} />
            <span className="hand">a good brief is a good beginning.</span>
            <p>
              Be specific. Say what you actually do. The best creative starts
              with something true.
            </p>
          </div>
          {brand.sources.length ? (
            <div className="source-list">
              <h3>Where it came from</h3>
              {brand.sources.map((s, i) => (
                <div key={i}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.url}
                    <ArrowUpRight size={13} />
                  </a>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}
export function NewCampaign() {
  const { studio, refresh } = useStudio();
  const navigate = useNavigate();
  const [goal, setGoal] = useState("Sales");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!studio) return null;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/campaigns", {
        name: form.get("name"),
        offer: form.get("offer"),
        goal,
      });
      await refresh();
      navigate(`/studio/campaign/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to="/studio" className="back-link">
        <ArrowLeft size={15} />
        Back to your studio
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A FRESH PAGE</span>
          <h1>
            What shall we{" "}
            <Highlight>
              <em>make today?</em>
            </Highlight>
          </h1>
          <p>A little direction. A lot of possibility.</p>
        </div>
      </div>
      <div className="campaign-create-layout">
        <form className="campaign-form" onSubmit={submit}>
          <Field label="Give your campaign a name">
            <input
              name="name"
              placeholder="A little autumn inspiration"
              required
              maxLength={100}
            />
          </Field>
          <Field label="What would you like it to do?">
            <div className="goal-grid" role="group" aria-label="Campaign goal">
              {[
                ["Sales", "Find more customers"],
                ["Bookings", "Fill your calendar"],
                ["Enquiries", "Start a conversation"],
                ["Awareness", "Get your name out there"],
              ].map(([g, desc]) => (
                <button
                  type="button"
                  key={g}
                  aria-pressed={goal === g}
                  className={goal === g ? "selected" : ""}
                  onClick={() => setGoal(g)}
                >
                  <strong>
                    {g}
                    {goal === g ? <Check size={16} /> : null}
                  </strong>
                  <small>{desc}</small>
                </button>
              ))}
            </div>
          </Field>
          <Field
            label="Anything special to share?"
            hint="An offer, a launch or just a reason to say hello. Optional."
          >
            <textarea
              name="offer"
              rows={3}
              defaultValue={studio.brand.offer}
              maxLength={500}
              placeholder="Our new collection is here…"
            />
          </Field>
          <div className="using-brand">
            <span className="brand-initial">{studio.brand.name[0]}</span>
            <div>
              <small>CREATING FOR</small>
              <strong>{studio.brand.name}</strong>
            </div>
            <Link to="/studio/brand">
              Edit brief
              <ArrowUpRight size={14} />
            </Link>
          </div>
          {!studio.brand.description ? (
            <Notice>
              Add a description in{" "}
              <Link to="/studio/brand">your brand brief</Link> before creating a
              campaign.
            </Notice>
          ) : null}
          {error ? <Notice>{error}</Notice> : null}
          <Button
            className="full large"
            busy={busy}
            disabled={!studio.brand.description}
          >
            Find my campaign angles
            <ArrowUpRight size={17} />
          </Button>
          <p className="form-footnote">
            No generation credits used until you approve your concepts.
          </p>
        </form>
        <aside className="kit-summary">
          <span className="tape" />
          <span className="hand">one brief. nine possibilities.</span>
          <h2>
            A little kit
            <br />
            with a lot in it.
          </h2>
          <div className="kit-items">
            {[
              ["03", "Video ads", "Vertical stories for your brand"],
              ["03", "Image ads", "A strong first impression"],
              ["03", "Organic posts", "Images and words that feel like you"],
            ].map(([n, title, desc]) => (
              <div key={title}>
                <b>{n}</b>
                <div>
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="kit-price">
            <span>A complete kit</span>
            <strong>100 credits</strong>
          </div>
          <p>{studio.balance} credits available in your workspace</p>
          <small>
            Preview mode makes sample assets. Live videos will target 15 seconds
            after provider validation.
          </small>
        </aside>
      </div>
    </>
  );
}
