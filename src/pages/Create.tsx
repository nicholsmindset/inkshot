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
import { MARKETS, type Brand } from "../../shared/types";
import { BriefReadiness } from "../components/BriefReadiness";
import { brandDraftKey, readBrandDraft, writeBrandDraft, clearBrandDraft } from "../brand-draft";
function sameSiteLogo(value: string | undefined, website: string) {
  try {
    if (!value) return undefined;
    const logo = new URL(value);
    return logo.protocol === "https:" && !logo.username && !logo.password &&
      logo.origin === new URL(website).origin ? logo.href : undefined;
  } catch {
    return undefined;
  }
}

export function BrandPage() {
  const { studio } = useStudio();
  return studio ? (
    <BrandForm key={`${studio.user.id}:${studio.user.workspaceId}`} initial={studio.brand} />
  ) : null;
}
function BrandForm({ initial }: { initial: Brand }) {
  const { studio, refresh, notify } = useStudio();
  const navigate = useNavigate();
  const draftKey = brandDraftKey(studio!.user.id, studio!.user.workspaceId);
  const [recovery] = useState(() => {
    try { return readBrandDraft(window.sessionStorage, draftKey); } catch { return null; }
  });
  const [restored, setRestored] = useState(!!recovery);
  const [savedBrand, setSavedBrand] = useState(initial);
  const [draftStored, setDraftStored] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedWebsite = searchParams.get("website");
  const startedWebsiteRead = useRef(false);
  const [brand, setBrand] = useState<Brand>(recovery?.brand ?? initial);
  const dirty = JSON.stringify(brand) !== JSON.stringify(savedBrand);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [readPreview, setReadPreview] = useState<Brand | null>(null);
  const [url, setUrl] = useState(searchParams.get("website") || recovery?.brand.website || initial.website);
  const set = (key: keyof Brand, value: unknown) =>
    setBrand((b) => ({
      ...b,
      [key]: value,
      evidence: (b.evidence || []).filter(item => item.field !== key),
      inferredFields: (b.inferredFields || []).filter(field => field !== key),
    }));
  useEffect(() => {
    try {
      if (dirty) setDraftStored(writeBrandDraft(window.sessionStorage, draftKey, brand, savedBrand));
      else { clearBrandDraft(window.sessionStorage, draftKey); setDraftStored(false); }
    } catch { setDraftStored(false); }
  }, [brand, savedBrand, dirty, draftKey]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const warnNavigation = (event: MouseEvent) => {
      if (draftStored || !(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      if (!window.confirm("Your brief has unsaved changes and browser recovery is unavailable. Leave without saving?")) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", warnNavigation, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", warnNavigation, true); };
  }, [dirty, draftStored]);
  async function read(requestedUrl = url) {
    if ((dirty || brand.description.trim()) && !window.confirm("Replace the brief fields with a new website reading? Your photo, logo and certificate will be kept. Choose Cancel to keep your current wording.")) return;
    setBusy("read");
    setError("");
    setReadError("");
    setReadPreview(null);
    try {
      let address = requestedUrl.trim();
      if (/^http:\/\//i.test(address)) address = address.replace(/^http:/i, "https:");
      else if (!/^https:\/\//i.test(address)) address = `https://${address}`;
      const next = await api<Brand>("/brand/read", { url: address });
      setBrand((current) => ({
        ...next,
        ...(current.certifications ? { certifications: current.certifications } : {}),
        ...(current.photoId ? { photoId: current.photoId } : {}),
        ...(current.logoId ? { logoId: current.logoId } : {}),
      }));
      setReadPreview(next);
      notify(
        (studio?.writingMode ?? studio?.mode) === "mock"
          ? "Website text imported. Review and refine your brief below."
          : "Your brand brief is ready to review.",
      );
    } catch (e) {
      // Reading a site can fail (blocked, no text, bad address). Always show a way forward.
      setReadError(`${(e as Error).message} You can still continue: type your details below, or paste your About text or menu items into “Facts we can use”.`);
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (!requestedWebsite || startedWebsiteRead.current) return;
    startedWebsiteRead.current = true;
    if (recovery) { setSearchParams({}, { replace: true }); return; }
    void read(requestedWebsite).finally(() => setSearchParams({}, { replace: true }));
  }, [requestedWebsite, setSearchParams]);
  const logoLink = sameSiteLogo(brand.logoUrl?.trim(), brand.website);
  async function useSiteLogo() {
    if (!logoLink) return;
    setBusy("site-logo");
    setError("");
    try {
      const result = await api<{ id: string }>("/brand/import-logo", { website: brand.website, logoUrl: logoLink });
      setBrand((current) => sameSiteLogo(current.logoUrl?.trim(), current.website) === logoLink
        ? { ...current, logoId: result.id } : current);
      notify("Logo imported. Review the preview and save your brand.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const continueToCampaign = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "continue";
    setBusy("save");
    setError("");
    try {
      const logoUrl = brand.logoUrl?.trim();
      if (logoUrl && !logoLink) {
        throw new Error("Choose an HTTPS logo link on the same site as your brand website.");
      }
      const saved = await api<Brand>("/brand", { ...brand, logoUrl: logoUrl || undefined }, "PUT");
      setBrand(saved);
      setSavedBrand(saved);
      setRestored(false);
      try { clearBrandDraft(window.sessionStorage, draftKey); } catch { /* Storage can be unavailable. */ }
      await refresh();
      notify("Your brand brief has been saved.");
      if (continueToCampaign) navigate("/studio/new");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function upload(file?: File, purpose: "photo" | "logo" | "certificate" = "photo") {
    if (!file) return;
    setBusy("upload");
    setError("");
    try {
      const data = new FormData();
      data.append("purpose", purpose);
      data.append("photo", file);
      const result = await api<{ id: string }>("/uploads", data);
      if (purpose === "certificate") set("certifications", { muisHalal: "not_certified", certificateId: result.id });
      else set(purpose === "logo" ? "logoId" : "photoId", result.id);
      notify("Upload added. Save your brief to keep it.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="journey-steps" aria-label="Campaign setup progress">
        <span>01 Your site</span><span className="active">02 Your brief</span><span>03 Your kit</span>
      </div>
      <div className="page-heading">
        <div>

          <h1>
            Your brand brief
          </h1>
          <p>Review your business facts and creative direction before making a campaign.</p>
        </div>
        <Button type="submit" form="brand-brief-form" name="action" value="continue" variant="secondary" disabled={!!busy}>
          Save and start a campaign
          <ArrowUpRight size={17} />
        </Button>
      </div>
      {restored ? <Notice>
        Your unsaved brief from this tab has been restored. Review it before saving.
        {recovery?.base !== JSON.stringify(initial) ? " The saved brief has changed since this draft began." : ""}
        {" "}<button type="button" disabled={!!busy} onClick={() => { setBrand(initial); setSavedBrand(initial); setRestored(false); }}>Discard draft and use saved brief</button>
      </Notice> : null}
      <p className="brand-save-status" role="status">{dirty
        ? draftStored ? "Unsaved changes · recovered in this tab for up to 24 hours. Save before starting a campaign." : "Unsaved changes · browser recovery is unavailable. Save before leaving."
        : "No unsaved changes. Review your brief before starting a campaign."}</p>
      <BriefReadiness brand={brand} />
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
                onChange={(e) => {
                  setUrl(e.target.value);
                  setReadPreview(null);
                }}
              />
              <Button
                disabled={!url.trim() || !!busy}
                busy={busy === "read"}
                onClick={() => void read()}
              >
                Read my site
              </Button>
            </div>
            {readError ? <Notice>{readError}</Notice> : null}
            {busy === "read" ? <p className="read-progress" role="status"><span className="read-spinner" /> Reading public pages and preparing your editable brief…</p> : null}
            {!busy && readPreview ? <p className="read-progress read-complete"><Check size={16} /> Site read. Check every fact and offer before saving.</p> : null}
            {(studio?.writingMode ?? studio?.mode) === "mock" ? (
              <small>
                Preview mode imports page text for you to refine. AI brief
                writing is not active.
              </small>
            ) : null}
          </div>
          {busy === "read" || readPreview ? (
            <SiteReadingScene website={url} brief={readPreview} />
          ) : null}
          <form id="brand-brief-form" className="brand-form" onSubmit={save}>
            <fieldset className="brand-fields" disabled={!!busy}>
            <div className="form-section-heading">
              <span className="hand">01</span>
              <h2>Your story</h2>
            </div>
            <Field label="Brand website" hint="You can enter this manually if the site could not be read.">
              <input type="url" value={brand.website} onChange={(e) => set("website", e.target.value)} placeholder="https://yourbusiness.com" />
            </Field>
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
            <Field label="What problem do customers need solved?" hint={brand.inferredFields?.includes("pain") ? "Suggested from your website. Review and edit to confirm." : "Describe the customer problem your offering addresses."}>
              <textarea rows={3} value={brand.pain || ""} maxLength={1000} onChange={e => set("pain", e.target.value)} />
            </Field>
            <Field label="When do they look for a solution?" hint={brand.inferredFields?.includes("trigger") ? "Suggested buying occasion. Review and edit to confirm." : "A situation or occasion that brings customers to you."}>
              <textarea rows={2} value={brand.trigger || ""} maxLength={1000} onChange={e => set("trigger", e.target.value)} />
            </Field>
            <Field label="Visual direction" hint={brand.inferredFields?.includes("visualDirection") ? "Suggested creative direction. Review and edit to confirm." : "Describe the setting, people, materials and mood suitable for your ads."}>
              <textarea rows={3} value={brand.visualDirection || ""} maxLength={1500} onChange={e => set("visualDirection", e.target.value)} />
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
            <details className="optional-certification"><summary>Certification claims <span>Optional · only if relevant to your business</span></summary>
            <p>Halal and MUIS wording is blocked until you upload a certificate and confirm it applies to this business. An upload is your declaration; Inkshot does not verify authenticity or current certification status.</p>
            <Field label="Certificate image" hint="Upload a clear PNG, JPG or WebP of your current certificate. It stays private and is not added to your ads.">
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy}
                onChange={e => void upload(e.target.files?.[0], "certificate")} />
            </Field>
            {brand.certifications?.certificateId ? <p>Certificate uploaded. <a href={"/api/uploads/" + brand.certifications.certificateId} target="_blank" rel="noopener noreferrer">Review certificate</a> <button type="button" onClick={() => set("certifications", { muisHalal: "not_certified" })}>Remove certificate</button></p> : null}
            <Field label="MUIS certification declaration">
              <select value={brand.certifications?.muisHalal || "not_certified"}
                onChange={e => set("certifications", { ...brand.certifications, muisHalal: e.target.value })}>
                <option value="not_certified">Not attested — keep certification wording off</option>
                <option value="attested" disabled={!brand.certifications?.certificateId}>I confirm this certificate is current and applies to my business</option>
              </select>
            </Field>
            <p className="muted">Generated visuals must never draw certification logos, seals or marks. Review every ad before publishing.</p>
            </details>
            <div className="form-section-heading"><span className="hand">03</span><h2>Your visual identity</h2></div>
            <Field label="Logo for exported ads" hint="Upload a PNG, JPG or WebP you own. Transparent PNGs retain their background transparency.">
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy}
                onChange={(e) => void upload(e.target.files?.[0], "logo")} />
            </Field>
            {brand.logoId && <div><img src={"/api/uploads/" + brand.logoId} width={90} alt="Logo for exports" />
              <button type="button" onClick={() => set("logoId", undefined)}>Remove logo</button></div>}
            <Field label="Where are your customers?" hint="Sets the ad rules, wording and (where available) the currency used for your copy.">
              <select value={brand.market ?? ""} onChange={(e) => set("market", e.target.value || undefined)}>
                <option value="">Singapore (default)</option>
                {Object.entries(MARKETS).filter(([code]) => code !== "SG").map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
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
            <Field label="Logo reference" hint="Optional. Paste a link to a logo on your brand website, or clear the field to remove it.">
              <input
                type="url"
                value={brand.logoUrl || ""}
                placeholder="https://yourbusiness.com/logo.png"
                onChange={(e) => set("logoUrl", e.target.value)}
                maxLength={2048}
              />
            </Field>
            {logoLink && (
              <div className="form-actions">
                <a href={logoLink} target="_blank" rel="noopener noreferrer">Open logo reference</a>
                <Button type="button" variant="secondary" busy={busy === "site-logo"} disabled={!!busy} onClick={() => void useSiteLogo()}>
                  Use this site logo in ads
                </Button>
              </div>
            )}
            {error ? <Notice>{error}</Notice> : null}
            <div className="form-actions">
              <span className="muted">
                Your brand goes with every campaign.
              </span>
              <Button busy={busy === "save"} disabled={!!busy}>
                <Check size={17} />
                Save my brand
              </Button>
              <Button type="submit" name="action" value="continue" disabled={!!busy}>Save and continue <ArrowUpRight size={17} /></Button>
            </div>
            </fieldset>
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
          {brand.inferredFields?.length ? <Notice>Suggested fields needing review: {brand.inferredFields.map(field => (({ pain: "customer problem", trigger: "buying occasion", visualDirection: "visual direction", audience: "audience", voice: "voice" } as Record<string, string>)[field] || field)).join(", ")}. Edit a field to confirm your wording.</Notice> : null}
          {brand.evidence?.length ? (
            <div className="source-list">
              <h3>Evidence by field</h3>
              {brand.evidence.map((item, index) => (
                <details key={index}>
                  <summary>{(({ description: "Offering", audience: "Audience", pain: "Customer problem", trigger: "Buying occasion", visualDirection: "Visual direction", voice: "Voice", offer: "Offer", proof: "Proof" } as Record<string, string>)[item.field] || item.field)}</summary>
                  <p>{item.excerpt}</p>
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer">Read source <ArrowUpRight size={13} /></a>
                </details>
              ))}
            </div>
          ) : null}
          {brand.sources.length ? (
            <div className="source-list">
              <h3>Sources for this brief</h3>
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
function SiteReadingScene({ website, brief }: { website: string; brief: Brand | null }) {
  const copy = brief?.description.slice(0, 360) || "";
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    if (!brief) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(copy.length);
      return;
    }
    let frame = 0;
    let started = 0;
    const type = (time: number) => {
      if (!started) started = time;
      const count = Math.min(copy.length, Math.floor((time - started) / 15));
      setVisible(count);
      if (count < copy.length) frame = requestAnimationFrame(type);
    };
    setVisible(0);
    frame = requestAnimationFrame(type);
    return () => cancelAnimationFrame(frame);
  }, [brief, copy]);
  return (
    <div className="site-reading-scene">
      <div className="site-reading-steps">
        <span className="eyebrow">FROM SITE TO STORY</span>
        <h3>{brief ? "Your first draft." : "Reading your site."}</h3>
        <p>{website}</p>
        <ol>
          <li className="done"><Check size={17} /> Public website supplied</li>
          <li className={brief ? "done" : "active"}>{brief ? <Check size={17} /> : <span className="read-spinner" />} Reading the page copy</li>
          <li className={brief ? "done" : "pending"}>{brief ? <Check size={17} /> : <span className="read-step-dot" />} Preparing an editable draft</li>
        </ol>
      </div>
      <div className="brief-sheet">
        <div className="brief-sheet-top"><span className="hand">draft</span><small>website copy · review before saving</small></div>
        <h4>{brief?.name || "Your brand"}</h4>
        <div className="brief-sheet-row">
          <span>what you do</span>
          {brief ? (
            <p><span className="sr-only">{copy}</span><span aria-hidden="true">{copy.slice(0, visible)}{visible < copy.length ? <i className="typing-caret" /> : null}</span></p>
          ) : <div className="brief-placeholder" aria-label="Reading your website"><span /><span /><span /></div>}
        </div>
        {brief?.audience ? <div className="brief-sheet-row"><span>who it's for</span><p>{brief.audience}</p></div> : null}
      </div>
    </div>
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
      <BriefReadiness brand={studio.brand} editLink />
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
            label="Customer-facing offer or launch"
            hint="Write only the message customers should see, not instructions for the AI. Leave blank if there is no offer."
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
            <strong>{studio.plan?.kitCredits ?? "…"} credits</strong>
          </div>
          <p>{studio.balance} credits available in your workspace</p>
          <small>{studio.mode === 'live' ? `Video generations target ${studio.videoDurationSeconds ?? 10} seconds. We return credits for assets that fail.` : `Preview mode makes sample assets. New live videos target ${studio.videoDurationSeconds ?? 10} seconds after provider validation.`}</small>
        </aside>
      </div>
    </>
  );
}
