import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowUpRight,
  Plus,
  Film,
  Image,
  MessageSquare,
  FolderOpen,
  Download,
  Search,
  Check,
  Feather,
  ArrowLeft,
  LoaderCircle,
  SlidersHorizontal,
  Play,
} from "lucide-react";
import { useStudio } from "../context";
import { Button, Empty, Status, Modal, Field, Notice } from "../ui";
import { api, media } from "../api";
import type { Asset, Version, Campaign, CampaignDraft, AssetDraft } from "../../shared/types";
import { isCampaignDestination } from "../../shared/destination";
import { startVisiblePolling } from "../visible-polling";
const icons = { video: Film, image: Image, post: MessageSquare };
function CampaignProgress({ step }: { step: number }) {
  return <ol className="campaign-progress" aria-label="Campaign workflow">
    {["Brand brief", "Choose angles", "Edit prompts", "Review & export"].map((label, index) =>
      <li key={label} aria-current={index === step ? "step" : undefined} className={index === step ? "current" : index < step ? "previous" : ""}>
        <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong>
      </li>)}
  </ol>;
}
function selectedVersion(asset: Asset) {
  return asset.versions.find((version) => version.id === asset.current_version_id) || asset.versions[0];
}

function assetCounts(assets: Asset[]) {
  return assets.reduce((counts, asset) => {
    const status = selectedVersion(asset)?.status;
    if (status === "ready") counts.ready += 1;
    else if (status === "failed") counts.failed += 1;
    else counts.running += 1;
    return counts;
  }, { ready: 0, running: 0, failed: 0 });
}

export function Dashboard() {
  const { studio } = useStudio();
  if (!studio) return null;
  const counts = assetCounts(studio.assets);
  const draft = studio.campaigns.find((campaign) => campaign.status === "draft");
  const preview = studio.assets.find((asset) => selectedVersion(asset)?.status === "ready");
  const previewVersion = preview && selectedVersion(preview);
  const nextPath = draft ? `/studio/campaign/${draft.id}` : studio.brand.description ? "/studio/new" : "/studio/brand";
  const nextLabel = draft ? "Continue draft" : studio.brand.description ? "Create a campaign" : "Set up your brand";
  return <>
    <div className="page-heading">
      <div><span className="studio-page-kicker">YOUR CREATIVE WORKSPACE</span><h1>{studio.brand.name}<em> studio</em></h1><p>Plan campaigns, review your ads and download approved versions.</p></div>
      <Link to="/studio/brand" className="button secondary">Brand brief <ArrowUpRight size={17} /></Link>
    </div>
    <section className="studio-overview">
      <div className="studio-next-action">
        <span className="studio-context">{draft ? "Saved campaign" : "Your next campaign"}</span>
        <h2>{draft ? draft.name : "Start with your business."}</h2>
        <p>{draft
          ? draft.draft?.assets.length
            ? `${draft.draft.assets.length} prompts saved. Review your creative direction before making the kit.`
            : "Choose three angles and write the prompts for your campaign."
          : studio.brand.description
            ? "Choose your offer and audience, then shape three video ads, three image ads and three posts."
            : "Add your website, check the business details and bring in your logo and photos."}</p>
        {draft && <span className="studio-draft-meta">{draft.goal} · {draft.draft?.selectedConceptIds.length ?? 3} angles selected{draft.draft && draft.draft.revision > 0 ? " · Saved to studio" : ""}</span>}
        <Link to={nextPath} className="button">{nextLabel}<ArrowUpRight size={17} /></Link>
        {draft && <Link to="/studio/new" className="text-link">Start another campaign <Plus size={15} /></Link>}
      </div>
      {preview && previewVersion ? <Link className="studio-latest-preview" to={`/studio/campaign/${preview.campaign_id}`}>
        <img src={media(previewVersion.id, true)} alt={preview.title + " current version preview"} />
        <span><strong>{preview.title}</strong><small>{draftLabels[preview.kind]} · Version {previewVersion.n}</small></span>
      </Link> : studio.brand.photoId ? <figure className="studio-latest-preview"><img src={`/api/uploads/${studio.brand.photoId}`} alt={studio.brand.name + " brand photo"} /><figcaption>Photo from your brand brief</figcaption></figure> : <div className="studio-workflow">
        <h3>Your campaign workflow</h3>
        <ol><li><strong>Check your brand brief</strong><span>Confirm your offer, audience and proof.</span></li><li><strong>Choose angles and edit prompts</strong><span>Approve the plan for every asset.</span></li><li><strong>Review and download</strong><span>Keep the versions you want to use.</span></li></ol>
      </div>}
    </section>
    <div className="studio-metrics" aria-label="Studio overview">
      <Link to="/studio/billing"><span>{studio.mode === "live" ? "Available credits" : "Preview credits"}</span><strong>{studio.balance}</strong><small>A complete kit uses 100 credits</small></Link>
      <Link to="/studio/library"><span>Ready to download</span><strong>{counts.ready}</strong><small>Current versions</small></Link>
      <Link to="/studio/library"><span>In progress</span><strong>{counts.running}</strong><small>Queued or generating</small></Link>
      <Link to="/studio/library"><span>Need attention</span><strong>{counts.failed}</strong><small>{counts.failed ? "Open an asset to review its error" : "No failed current versions"}</small></Link>
    </div>
    <div className="section-heading"><h2>Recent campaigns</h2><Link className="text-link" to="/studio/library">Open library <ArrowUpRight size={15} /></Link></div>
    {studio.campaigns.length ? <div className="campaign-list">
      {studio.campaigns.slice(0, 5).map((campaign) => {
        const campaignAssets = studio.assets.filter((asset) => asset.campaign_id === campaign.id);
        const summary = assetCounts(campaignAssets);
        const cover = campaignAssets.map(selectedVersion).find(version => version?.status === "ready");
        return <Link key={campaign.id} to={`/studio/campaign/${campaign.id}`} className="campaign-row studio-campaign-row">
          <div className="campaign-cover">{cover ? <img src={media(cover.id, true)} alt="" loading="lazy" /> : studio.brand.photoId ? <img src={`/api/uploads/${studio.brand.photoId}`} alt="" loading="lazy" /> : <FolderOpen size={25} aria-hidden="true" />}</div>
          <div><strong>{campaign.name}</strong><small>{campaign.goal} · {new Date(campaign.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>
            <span className="studio-campaign-summary">{campaign.status === "draft" ? `${campaign.draft?.assets.length || 0} prompts saved` : `${summary.ready} ready · ${summary.running} in progress · ${summary.failed} failed`}</span></div>
          <Status status={campaign.status} /><ArrowUpRight size={18} />
        </Link>;
      })}
    </div> : <div className="studio-empty-campaigns"><FolderOpen size={22} /><p>Your campaigns will appear here after you create the first brief.</p></div>}
  </>;
}
export function AssetCard({
  asset,
  onOpen,
}: {
  asset: Asset;
  onOpen: () => void;
}) {
  const v = selectedVersion(asset);
  if (!v) return null;
  const Icon = icons[asset.kind];
  return (
    <button className="asset-card" onClick={onOpen}>
      <div
        className={`asset-image ${asset.kind === "video" ? "video-card" : ""}`}
      >
        {v.status === "ready" ? (
          <img
            src={media(v.id, true)}
            alt={`${asset.title} ${asset.kind} creative`}
            loading="lazy"
          />
        ) : (
          <div className="making-placeholder">
            <Icon size={32} />
            <span>
              {v.status === "failed"
                ? "Generation failed"
                : v.status === "queued" ? "Waiting to generate" : "Generating your asset"}
            </span>
            {v.status !== "failed" ? (
              <LoaderCircle className="spin" size={20} />
            ) : null}
          </div>
        )}
        <span className="asset-type">
          <Icon size={12} />
          {asset.kind === "video"
            ? v.mock
              ? "Sample clip"
              : "Video ad"
            : asset.kind === "image"
              ? "Image ad"
              : "Organic post"}
        </span>
        {asset.kind === "video" && v.status === "ready" ? (
          <span className="asset-play">
            <Play size={22} fill="currentColor" />
          </span>
        ) : null}
        <span className="asset-format">{asset.format}</span>
      </div>
      <div className="asset-info">
        <div>
          <h3>{asset.title}</h3>
          <span>
            Version {v.n} ·{" "}
            {v.mock ? "Sample creative" : `${v.credit_cost} credits`}
          </span>
        </div>
        <ArrowUpRight size={17} />
      </div>
      <div className="asset-card-footer">
        <Status status={v.status} />
        <span>{asset.versions.length} {asset.versions.length === 1 ? "version" : "versions"}</span>
      </div>
    </button>
  );
}
export function Library() {
  const { studio } = useStudio();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  if (!studio) return null;
  const counts = assetCounts(studio.assets);
  const assets = studio.assets.filter(
    (a) =>
      (filter === "all" || a.kind === filter) &&
      (campaignFilter === "all" || a.campaign_id === campaignFilter) &&
      (stateFilter === "all" || (stateFilter === "running"
        ? ["queued", "making"].includes(selectedVersion(a)?.status || "queued")
        : selectedVersion(a)?.status === stateFilter)) &&
      (a.title + " " + (studio.campaigns.find((c) => c.id === a.campaign_id)?.name || "")).toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Your <em>library</em></h1>
          <p>{counts.ready} ready to download · {counts.running} in progress · {counts.failed} need attention</p>
        </div>
        <Link to="/studio/new" className="button">
          <Plus size={17} />
          New campaign
        </Link>
      </div>
      <div className="library-toolbar">
        <div className="filter-tabs" role="group" aria-label="Asset type">
          {[
            ["all", "All assets"],
            ["video", "Videos"],
            ["image", "Images"],
            ["post", "Posts"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
              {value === "all" ? <span>{studio.assets.length}</span> : null}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={17} />
          <input
            placeholder="Search assets or campaigns"
            aria-label="Search assets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="library-selectors">
        <Field label="Campaign"><select value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)}><option value="all">All campaigns</option>{studio.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></Field>
        <Field label="Asset status"><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="all">All statuses</option><option value="ready">Ready to download</option><option value="running">In progress</option><option value="failed">Needs attention</option></select></Field>
        <span role="status">{assets.length} {assets.length === 1 ? "asset" : "assets"}</span>
      </div>
      {assets.length ? (
        filter === "all" && !query.trim() ? (
          <div className="library-shelves">
            {(["video", "image", "post"] as const).map((kind) => {
              const shelf = assets.filter((a) => a.kind === kind);
              if (!shelf.length) return null;
              return <section className="asset-shelf" key={kind}>
                <div className="section-heading"><h2>{kind === "video" ? "Paid video ads" : kind === "image" ? "Paid image ads" : "Organic posts"}</h2><span className="muted">{shelf.length}</span></div>
                <div className="assets-grid">{shelf.map((a) => <AssetCard key={a.id} asset={a} onOpen={() => setSelected(a.id)} />)}</div>
              </section>;
            })}
          </div>
        ) : <div className="assets-grid">
          {assets.map((a) => <AssetCard key={a.id} asset={a} onOpen={() => setSelected(a.id)} />)}
        </div>
      ) : (
        <Empty
          icon={<FolderOpen size={30} />}
          title={
            studio.assets.length
              ? "No matching assets"
              : "Your library is ready for its first campaign"
          }
          description={
            studio.assets.length
              ? "Try another campaign, status or search term."
              : "Your campaign videos, images and posts will live here."
          }
        >
          {studio.assets.length ? <Button variant="secondary" onClick={() => { setQuery(""); setFilter("all"); setCampaignFilter("all"); setStateFilter("all"); }}>Clear filters</Button> : <Link to="/studio/new" className="button">Create a campaign <Plus size={17} /></Link>}
        </Empty>
      )}
      <AssetEditor
        asset={studio.assets.find((a) => a.id === selected) || null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
export function CampaignDetail() {
  const { id } = useParams();
  const { studio } = useStudio();
  if (!id || !studio) return null;
  return <CampaignScreen key={studio.user.workspaceId + ":" + id} id={id} workspaceId={studio.user.workspaceId} />;
}

const draftKinds = ["video", "image", "post"] as const;
const draftLabels = { video: "Video ad", image: "Image ad", post: "Organic post" };

function draftContents(draft: CampaignDraft) {
  const { revision: _revision, ...contents } = draft;
  return JSON.stringify(contents);
}

function CampaignPlanner({ campaign, workspaceId }: { campaign: Campaign; workspaceId: string }) {
  const { studio, refresh, notify } = useStudio();
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [savedContents, setSavedContents] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<"prompts" | "generate" | "">("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [approved, setApproved] = useState("");
  const legacyKey = "inkshot:campaign-draft:" + workspaceId + ":" + campaign.id;
  const legacyEdits = useRef<Record<string, string>>({});
  const recoveryKey = legacyKey + ":v2";
  const contents = draft ? draftContents(draft) : "";
  const dirty = !!draft && contents !== savedContents;
  const destinationValid = !draft?.destinationUrl || isCampaignDestination(draft.destinationUrl);

  useEffect(() => {
    let canceled = false;
    try {
      const stored = JSON.parse(sessionStorage.getItem(legacyKey) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        legacyEdits.current = Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === "string")) as Record<string, string>;
      }
    } catch { /* The server draft remains available when local storage is unavailable. */ }
    api<CampaignDraft>(`/campaigns/${campaign.id}/draft`).then((saved) => {
      if (canceled) return;
      setSavedContents(draftContents(saved));
      let recovery: CampaignDraft | null = null;
      try {
        const stored = JSON.parse(sessionStorage.getItem(recoveryKey) || "null");
        if (stored && Number.isInteger(stored.revision) && Array.isArray(stored.selectedConceptIds) &&
            stored.selectedConceptIds.every((id: unknown) => typeof id === "string") &&
            Array.isArray(stored.assets) && stored.assets.every((asset: Partial<AssetDraft>) =>
              asset && typeof asset.conceptId === "string" && draftKinds.includes(asset.kind!) &&
              typeof asset.prompt === "string" && typeof asset.headline === "string" && typeof asset.cta === "string")) recovery = stored;
      } catch { /* Invalid local recovery does not replace the saved campaign. */ }
      if (recovery && draftContents(recovery) !== draftContents(saved)) {
        setDraft(recovery);
        if (recovery.revision !== saved.revision) {
          setConflict(true);
          setError("This tab has unsaved edits and a newer draft was saved elsewhere. Review your local edits before reloading.");
        }
      } else {
        setDraft(saved.revision === 0 && legacyEdits.current.destination
          ? { ...saved, destinationUrl: legacyEdits.current.destination }
          : saved);
      }
    }).catch((e: Error) => { if (!canceled) setError(e.message); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [campaign.id, legacyKey, recoveryKey]);

  useEffect(() => {
    if (!draft || !dirty || saving || action || error || !destinationValid) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      api<CampaignDraft>(`/campaigns/${campaign.id}/draft`, draft, "PATCH")
        .then((saved) => {
          setSavedContents(draftContents(saved));
          // Retain edits made while this save was in flight, then save them next.
          setDraft((current) => current && draftContents(current) !== draftContents(draft)
            ? { ...current, revision: saved.revision } : saved);
        })
        .catch((e: Error & { status?: number }) => {
          setConflict(e.status === 409);
          setError(e.message);
        })
        .finally(() => setSaving(false));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, saving, action, error, destinationValid, campaign.id]);

  useEffect(() => {
    if (!draft) return;
    try {
      if (dirty) sessionStorage.setItem(recoveryKey, JSON.stringify(draft));
      else sessionStorage.removeItem(recoveryKey);
    } catch { /* Server persistence remains available without local recovery. */ }
  }, [draft, dirty, recoveryKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(next: CampaignDraft) {
    setDraft(next);
    setApproved("");
  }

  async function reloadSaved() {
    setLoading(true);
    setError("");
    try {
      const saved = await api<CampaignDraft>(`/campaigns/${campaign.id}/draft`);
      setDraft(saved);
      setSavedContents(draftContents(saved));
      setConflict(false);
      setApproved("");
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function writePrompts() {
    if (!draft) return;
    setAction("prompts");
    setError("");
    setApproved("");
    try {
      const saved = await api<CampaignDraft>(`/campaigns/${campaign.id}/prompts`, {
        revision: draft.revision,
        selectedConceptIds: draft.selectedConceptIds,
      });
      setSavedContents(draftContents(saved));
      const legacy = legacyEdits.current;
      setDraft({ ...saved, assets: saved.assets.map((asset) => ({
        ...asset,
        headline: legacy[`${asset.conceptId}:${asset.kind}:headline`] ?? asset.headline,
        cta: legacy[`${asset.conceptId}:${asset.kind}`] ?? asset.cta,
      })) });
      legacyEdits.current = {};
      notify("Your prompts are ready to review.");
    } catch (e) {
      setConflict((e as { status?: number }).status === 409);
      setError((e as Error).message);
    } finally { setAction(""); }
  }

  async function generate() {
    if (!draft) return;
    setAction("generate");
    setError("");
    try {
      await api(`/campaigns/${campaign.id}/generate`, { approved: true, draftRevision: draft.revision });
      await refresh();
      try { sessionStorage.removeItem(legacyKey); } catch { /* Local recovery is optional. */ }
      notify("Your kit is on its way. You can leave this page.");
    } catch (e) {
      setConflict((e as { status?: number }).status === 409);
      setError((e as Error).message);
    } finally { setAction(""); }
  }

  if (loading) return <p role="status"><LoaderCircle size={16} className="spin" /> Loading your saved draft…</p>;
  if (!draft || !studio) return <><Notice>{error || "Your draft could not be loaded."}</Notice><Button onClick={() => void reloadSaved()}>Try again</Button></>;
  const duration = draft.videoDurationSeconds ?? (draft.assets.length ? 15 : studio.videoDurationSeconds ?? 10);
  const locked = !!action || conflict;
  const readyToWrite = draft.selectedConceptIds.length === 3 && !dirty && !saving && !error && destinationValid;
  const review = draft.revision + ":" + contents;
  const validAssets = draft.assets.length === 9 && draft.assets.every((asset) =>
    asset.prompt.trim() && asset.headline.trim() && asset.cta.trim() &&
    (asset.kind !== "video" || asset.motionPrompt?.trim()) &&
    (asset.kind !== "post" || asset.caption?.trim()));
  function updateAsset(index: number, patch: Partial<AssetDraft>) {
    edit({ ...draft!, assets: draft!.assets.map((asset, position) => position === index ? { ...asset, ...patch } : asset) });
  }
  return <div className="campaign-planner">
    <CampaignProgress step={draft.assets.length ? 2 : 1} />
    <div className="planner-save" role="status" aria-live="polite">
      {saving ? "Saving changes…" : error ? "Changes need attention" : dirty ? "Changes waiting to save" : "Saved to your studio"}
    </div>
    {error && <Notice>{error}
      {conflict ? <div className="planner-recovery"><p>Your edits are still visible below. Reloading replaces them with the latest saved draft.</p><Button variant="secondary" onClick={() => void reloadSaved()}>Reload saved draft</Button></div>
        : <div className="planner-recovery"><Button variant="secondary" onClick={() => setError("")}>Retry</Button></div>}
    </Notice>}
    <div className="section-heading"><h2>Choose three angles</h2><span>{draft.selectedConceptIds.length} of 3 selected</span></div>
    <div className="concept-grid planner-angles">
      {campaign.concepts.map((concept) => {
        const chosen = draft.selectedConceptIds.includes(concept.id);
        return <label className={`concept-card planner-angle${chosen ? " selected" : ""}`} key={concept.id}>
          <span className="planner-angle-check"><input type="checkbox" checked={chosen}
            aria-label={"Select angle: " + concept.title}
            disabled={locked || (!chosen && draft.selectedConceptIds.length === 3)}
            onChange={() => edit({ ...draft, assets: [], selectedConceptIds: chosen
              ? draft.selectedConceptIds.filter((id) => id !== concept.id)
              : [...draft.selectedConceptIds, concept.id] })} /><span>{chosen ? "Selected" : "Choose angle"}</span></span>
          <strong>{concept.title}</strong><h3>{concept.hook}</h3><p>{concept.description}</p>
        </label>;
      })}
    </div>
    {draft.assets.length > 0 && <p className="muted">Changing your angles clears these prompts so you can write a new set.</p>}
    <Field label="Campaign destination URL" hint="Included with your captions and downloads for ad placement.">
      <input type="url" value={draft.destinationUrl || ""} placeholder="https://yourbusiness.com/offer" maxLength={2048}
        disabled={locked} aria-invalid={!destinationValid}
        onChange={(event) => edit({ ...draft, destinationUrl: event.target.value || undefined })} />
    </Field>
    {!destinationValid && <Notice>Enter a full HTTPS link or leave the destination empty.</Notice>}
    {!draft.assets.length && <div className="planner-write"><Button busy={action === "prompts"} disabled={!readyToWrite || locked} onClick={() => void writePrompts()}>Write my nine prompts</Button><p>Review and edit the prompts before spending generation credits.</p></div>}
    {draft.assets.length > 0 && <>
      <div className="section-heading"><h2>Review your nine prompts</h2></div>
      {draftKinds.map((kind) => <section className="planner-shelf" key={kind} aria-label={draftLabels[kind] + " prompts"}>
        <h3>{kind === "video" ? `Video ads · ${duration} seconds` : kind === "image" ? "Image ads" : "Organic posts"}</h3>
        {draft.assets.map((asset, index) => {
          if (asset.kind !== kind) return null;
          const concept = campaign.concepts.find((item) => item.id === asset.conceptId);
          return <details className="planner-prompt" key={asset.conceptId + kind}>
            <summary><span><strong>{asset.headline || concept?.title}</strong><small>{concept?.title}</small></span><span className="planner-prompt-action">Edit prompt</span></summary>
            <div className="planner-prompt-fields">
              <Field label={kind === "video" ? "First-frame prompt" : "Visual prompt"}>
                <textarea rows={5} value={asset.prompt} maxLength={4000} disabled={locked}
                  onChange={(event) => updateAsset(index, { prompt: event.target.value })} />
              </Field>
              {kind === "video" && <Field label="Motion prompt" hint={`Describe what happens across the ${duration}-second clip. The first frame sets the scene.`}>
                <textarea rows={5} value={asset.motionPrompt || ""} maxLength={4000} disabled={locked}
                  onChange={(event) => updateAsset(index, { motionPrompt: event.target.value })} />
              </Field>}
              <div className="planner-copy-fields">
                <Field label="Headline"><input value={asset.headline} maxLength={120} disabled={locked} onChange={(event) => updateAsset(index, { headline: event.target.value })} /></Field>
                <Field label="Call to action"><input value={asset.cta} maxLength={55} disabled={locked} onChange={(event) => updateAsset(index, { cta: event.target.value })} /></Field>
              </div>
              {kind === "post" && <Field label="Post caption"><textarea rows={4} value={asset.caption || ""} maxLength={2000} disabled={locked} onChange={(event) => updateAsset(index, { caption: event.target.value })} /></Field>}
            </div>
          </details>;
        })}
      </section>)}
      <div className="planner-brand-preview">
        {draft.photoId && <figure><img src={"/api/uploads/" + encodeURIComponent(draft.photoId)} alt="Approved product photo" /><figcaption>Your approved photo starts each video and is used for image ads and posts.</figcaption></figure>}
        {campaign.brand.logoId && <img src={"/api/uploads/" + campaign.brand.logoId} alt="Approved brand logo" />}
        <span>Brand colour <strong>{campaign.brand.color}</strong></span>
      </div>
      {!draft.photoId && <Notice>No product photo is attached. {campaign.mock ? "Preview assets will use the sample image, not your actual product." : "The provider will invent the scene; product appearance is not guaranteed."} Add your own photo in the brand brief before starting a new campaign.</Notice>}
      {studio.balance < 100 && <Notice><strong>You need {100 - studio.balance} more credits to generate this kit.</strong> {campaign.mock ? "This preview has no paid checkout. You can save and edit every prompt without credits; sample rendering needs a test allowance." : "Your draft is saved. Review your plan before generating."} <Link to="/studio/billing">View usage and billing</Link></Notice>}
      <div className="approval-panel">
        <div><h3>Approve your saved prompts</h3><label className="checkbox-label"><input type="checkbox" checked={approved === review} disabled={locked || dirty || saving || !validAssets || !!error}
          onChange={(event) => setApproved(event.target.checked ? review : "")} />I’ve checked the prompts, offer and claims, and approve these nine assets.</label></div>
        <div><Button busy={action === "generate"} disabled={locked || approved !== review || !validAssets || dirty || saving || !!error || !destinationValid || studio.balance < 100} onClick={() => void generate()}>Make my kit <span className="button-credit">100 credits</span></Button><small>3 videos at {duration}s · 3 image ads · 3 posts. {studio.balance} credits available</small></div>
      </div>
    </>}
  </div>;
}

type ExportStatus = { id: string; state: string; downloadUrl?: string; errorCode?: string };
function CampaignDownloads({ campaignId }: { campaignId: string }) {
  const { studio } = useStudio();
  const [category, setCategory] = useState("all");
  const [job, setJob] = useState<ExportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  useEffect(() => {
    if (!job || !["queued", "processing"].includes(job.state)) return;
    let stopped = false;
    const stopPolling = startVisiblePolling(async () => {
      try {
        const result = await api<ExportStatus>(`/exports/${job.id}`);
        if (stopped) return;
        setJob(result);
        setError("");
      } catch (err) { if (!stopped) setError((err as Error).message); }
    });
    return () => { stopped = true; stopPolling(); };
  }, [job?.id, job?.state]);
  useEffect(() => () => { requestId.current++; }, []);
  async function prepare() {
    const current = ++requestId.current;
    setBusy(true); setError(""); setJob(null);
    try {
      const result = await api<ExportStatus>(`/campaigns/${campaignId}/exports`, { category });
      if (current === requestId.current) setJob(result);
    } catch (err) { if (current === requestId.current) setError((err as Error).message); }
    finally { if (current === requestId.current) setBusy(false); }
  }
  const working = busy || !!job && ["queued", "processing"].includes(job.state) && !error;
  const tooLarge = job?.state === "failed" && job.errorCode === "archive_too_large";
  const unreviewed = studio?.exportReviewRequired ? studio.assets.filter(asset =>
    asset.campaign_id === campaignId && (category === "all" || asset.kind === category) &&
    selectedVersion(asset)?.status === "ready" && !selectedVersion(asset)?.reviewed,
  ).length || 0 : 0;
  return <div className="campaign-downloads">
    <label>Download category<select value={category} disabled={working} onChange={event => { setCategory(event.target.value); setJob(null); setError(""); }}>
      <option value="all">All ready assets</option><option value="video">Video ads</option><option value="image">Image ads</option><option value="post">Organic posts</option>
    </select></label>
    {job?.state === "ready" && !unreviewed ? <a className="button secondary" href={job.downloadUrl || `/api/exports/${job.id}/download`}><Download size={17} />Download ZIP</a>
      : <Button variant="secondary" busy={working} disabled={tooLarge || unreviewed > 0} onClick={() => void prepare()}>Prepare download</Button>}
    <small role="status">{tooLarge ? "This download is too large. Choose a smaller category or download individual assets from their previews." : working ? "Preparing your files. You can keep reviewing your campaign." : job?.state === "failed" ? "Download could not finish. Try again or choose a smaller category." : "Includes captions and your campaign link."}</small>
    {unreviewed > 0 && <p role="status">Review {unreviewed} {unreviewed === 1 ? "asset" : "assets"} in this category before downloading. Open each preview and complete the export checks.</p>}
    {error && <Notice>{error}</Notice>}
  </div>;
}

function CampaignScreen({ id, workspaceId }: { id: string; workspaceId: string }) {
  const { studio } = useStudio();
  const [selected, setSelected] = useState<string | null>(null);
  if (!studio) return null;
  const campaign = studio.campaigns.find((c) => c.id === id);
  if (!campaign)
    return (
      <Empty
        icon={<FolderOpen />}
        title="Campaign not found"
        description="Open your studio to see your campaigns."
      >
        <Link to="/studio" className="button">
          Back to studio
        </Link>
      </Empty>
    );
  const assets = studio.assets.filter((a) => a.campaign_id === id);
  const done = assets.filter(
    (a) =>
      a.versions.find((v) => v.id === a.current_version_id)?.status === "ready",
  ).length;
  const summary = assetCounts(assets);
  // A prepared archive is an immutable snapshot. Reset it when the selected
  // versions or ready assets change so it cannot silently serve older artwork.
  const downloadRevision = JSON.stringify(assets.map(asset => {
    const version = asset.versions.find(item => item.id === asset.current_version_id);
    return [asset.id, version?.id, version?.status, asset.caption];
  }).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
  return (
    <>
      <Link to="/studio" className="back-link">
        <ArrowLeft size={15} />
        Back to your studio
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {campaign.goal.toUpperCase()} CAMPAIGN
          </span>
          <h1>{campaign.name}</h1>
          <p>
            {campaign.status === "draft"
              ? "Choose your angles, then review every prompt before generation."
              : `${summary.ready} ready · ${summary.running} in progress · ${summary.failed} need attention`}
          </p>
        </div>
        {done ? (
          <CampaignDownloads key={`${id}:${downloadRevision}`} campaignId={id} />
        ) : (
          <Status status={campaign.status} />
        )}
      </div>
      {campaign.mock ? (
        <div className="preview-banner">
          <Feather size={17} />
          <span>
            Sample campaign. Images use the sample or your uploaded photo;
            videos are still-image previews at the approved duration. No paid API calls.
          </span>
        </div>
      ) : null}
      {campaign.status === "draft" ? (
        <CampaignPlanner campaign={campaign} workspaceId={workspaceId} />
      ) : (
        <>
          {campaign.brand.destinationUrl && <p>Campaign destination · <a href={campaign.brand.destinationUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>{campaign.brand.destinationUrl}</a></p>}
          <div className="generation-progress">
            <div>
              <span>
                {done === 9 ? "Your kit is ready." : summary.running
                  ? "Your remaining assets are being prepared."
                  : "Open the failed assets to review or try another generation."}
              </span>
              <b>{done} / 9 ready</b>
            </div>
            <div className="progress-track">
              <i style={{ width: `${(done / 9) * 100}%` }} />
            </div>
          </div>
          {(["video", "image", "post"] as const).map((kind) => (
            <section className="asset-shelf" key={kind}>
              <div className="section-heading">
                <h2>
                  {kind === "video"
                    ? "Video ads"
                    : kind === "image"
                      ? "Image ads"
                      : "Organic posts"}
                </h2>
                <span className="muted">3 assets</span>
              </div>
              <div className="assets-grid">
                {assets
                  .filter((a) => a.kind === kind)
                  .map((a) => (
                    <AssetCard
                      asset={a}
                      key={a.id}
                      onOpen={() => setSelected(a.id)}
                    />
                  ))}
              </div>
            </section>
          ))}
        </>
      )}
      <AssetEditor
        asset={studio.assets.find((a) => a.id === selected) || null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
export function AssetEditor({
  asset,
  onClose,
}: {
  asset: Asset | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!asset}
      onClose={onClose}
      title={asset?.title || "Your asset"}
      description="Review the creative, edit its text or make a new version."
    >
      {asset ? <EditorContents key={asset.id} asset={asset} /> : null}
    </Modal>
  );
}
function HeadlineVariations({ assetId, version, pending, onCreated }: {
  assetId: string;
  version: Version;
  pending: boolean;
  onCreated: (versionId: string, headline: string) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ payload: string; id: string } | null>(null);
  const headlines = input.split("\n").map((line) => line.trim()).filter(Boolean);
  const valid = headlines.length >= 1 && headlines.length <= 5 &&
    headlines.every((line) => line.length <= 120) &&
    new Set(headlines.map((line) => line.toLowerCase())).size === headlines.length;
  async function create() {
    if (!valid || pending || busy || version.status !== "ready") return;
    setBusy(true);
    setError("");
    try {
      const payload = JSON.stringify([version.id, headlines]);
      if (request.current?.payload !== payload) {
        request.current = { payload, id: crypto.randomUUID() };
      }
      const result = await api<{ versionIds: string[] }>(
        "/assets/" + assetId + "/variations",
        { versionId: version.id, headlines, requestId: request.current.id },
      );
      await onCreated(result.versionIds[0], headlines[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="headline-variations">
      <Field label="Try different headlines" hint="Enter 1–5 distinct headlines, one per line. Up to 120 characters each. Each version keeps the image and call to action.">
        <textarea rows={4} value={input} disabled={busy} onChange={(e) => setInput(e.target.value)} />
      </Field>
      <Button variant="secondary" busy={busy} disabled={!valid || pending || version.status !== "ready"} onClick={() => void create()}>
        Create headline variations
      </Button>
      {error && <Notice>{error}</Notice>}
    </section>
  );
}

const exportChecks = [
  ["product", "The product or service is represented accurately."],
  ["offer", "The offer and price are correct."],
  ["claims", "Claims and certification statements are supported."],
  ["logo", "The logo and brand details are correct."],
  ["safeArea", "Text is readable and stays within the platform’s safe areas."],
  ["caption", "The caption is accurate and ready to publish."],
  ["destination", "The campaign link is correct, or this creative intentionally has no link."],
] as const;
type ExportCheck = typeof exportChecks[number][0];
function EditorContents({ asset }: { asset: Asset }) {
  const { studio, refresh, notify } = useStudio();
  const [vid, setVid] = useState(asset.current_version_id);
  const v = asset.versions.find((v) => v.id === vid) || asset.versions[0];
  const original = asset.versions.reduce((first, item) => item.n < first.n ? item : first);
  const supportsVariations = asset.kind === "image";
  const compare = supportsVariations && original.status === "ready" && v.id !== original.id;
  const [headline, setHeadline] = useState(v.headline);
  const [cta, setCta] = useState(v.cta);
  const [caption, setCaption] = useState(asset.caption);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<"edit" | "generate" | "select" | "refresh" | "review" | "">("");
  const [error, setError] = useState("");
  const [checks, setChecks] = useState<Partial<Record<ExportCheck, boolean>>>({});
  useEffect(() => { setChecks({}); }, [v.id, v.reviewFingerprint]);
  const pending = asset.versions.some((v) =>
    ["queued", "making", "rendering"].includes(v.status),
  );
  const campaign = studio?.campaigns.find(c => c.id === asset.campaign_id);
  const photoBackedImage = asset.kind !== "video" && !!campaign?.brand.photoId;
  async function revise(regenerate: boolean) {
    if (regenerate && photoBackedImage) return;
    setBusy(true);
    setOperation(regenerate ? "generate" : "edit");
    setError("");
    try {
      const result = await api<{ versionId: string }>(
        `/assets/${asset.id}/revise`,
        { versionId: v.id, headline, cta, caption, note, regenerate },
      );
      await refresh();
      setVid(result.versionId);
      setNote("");
      notify(
        regenerate
          ? "A fresh version is in the works."
          : "Your updated export is in the works.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setOperation("");
    }
  }
  async function makeCurrent() {
    setBusy(true);
    setOperation("select");
    setError("");
    try {
      await api(`/assets/${asset.id}/current`, { versionId: v.id }, "PUT");
      await refresh();
      notify("This is now your selected version.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setOperation("");
    }
  }
  async function refreshStatus() {
    setBusy(true);
    setOperation("refresh");
    setError("");
    try { await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setOperation(""); }
  }
  async function approveReview() {
    if (!v.reviewFingerprint || !exportChecks.every(([key]) => checks[key]) || unsavedCopy) return;
    setBusy(true); setOperation("review"); setError("");
    try {
      await api(`/assets/${asset.id}/review`, { versionId: v.id, fingerprint: v.reviewFingerprint, checks });
      await refresh();
      notify("This version is reviewed and ready to download.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setOperation(""); }
  }
  function select(version: Version) {
    setVid(version.id);
    setHeadline(version.headline);
    setCta(version.cta);
    setCaption(asset.caption);
    setNote("");
    setError("");
  }
  const generationCost = studio?.plan?.versionCredits[asset.kind] ?? Infinity;
  const regenLeft = asset.kind === "video" && studio?.videoRegen ? studio.videoRegen.cap - studio.videoRegen.used : Infinity;
  const canAffordGeneration = (studio?.balance ?? 0) >= generationCost;
  const validCopy = !!headline.trim() && !!cta.trim();
  const unsavedCopy = headline !== v.headline || cta !== v.cta || caption !== asset.caption;
  return (
    <>
      <div className="asset-version-summary">
        <div><strong>Version {v.n}</strong><span>{asset.current_version_id === v.id ? "Selected for campaign downloads" : "Viewing an alternate version"}</span></div>
        <div><strong>{v.credit_cost === 0 ? "Free text edit" : `${v.credit_cost} credits at creation`}</strong><span>{v.status === "failed" ? "Check credit history for returned credits" : v.mock ? "Sample mode" : draftLabels[asset.kind]}</span></div>
      </div>
      {pending && <div className="asset-progress-notice" role="status"><LoaderCircle size={18} className="spin" /><span>A version is being prepared. You can keep reviewing existing versions while it finishes.</span></div>}
      {v.status === "failed" && <Notice>{v.error || "This version could not be completed."}<p>You can choose an earlier ready version or request a new generation below.</p></Notice>}
      {compare && (
        <div className="variation-compare" aria-label="Compare image versions">
          {[original, v].map((item) => (
            <figure key={item.id}>
              <figcaption>{item.id === original.id ? "Original" : "Variation"} · Version {item.n}</figcaption>
              {item.status === "ready" ? (
                <img src={media(item.id)} alt={item.headline} />
              ) : (
                <div className="editor-wait" role="status">
                  <Status status={item.status} />
                  {item.error && <p>{item.error}</p>}
                </div>
              )}
              <p>{item.headline}</p>
            </figure>
          ))}
        </div>
      )}
      <div className={compare ? "editor-grid comparing" : "editor-grid"}>
        <div className="editor-preview">
          {compare ? null : v.status === "ready" ? (
            asset.kind === "video" ? (
              <video
                src={media(v.id)}
                controls
                playsInline
                poster={media(v.id, true)}
              />
            ) : (
              <img src={media(v.id)} alt={asset.title} />
            )
          ) : (
            <div className="editor-wait" role="status">
              <Status status={v.status} />
              {v.status === "failed" ? <p>Choose another version below, or generate a new one.</p> : <LoaderCircle className="spin" />}
            </div>
          )}
          {asset.caption ? (
            <div className="caption">
              <strong>Post caption</strong>
              <p>{asset.caption}</p>
              <Button
                variant="small secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(asset.caption)
                    .then(() => notify("Caption copied."))
                    .catch(() =>
                      notify(
                        "Could not copy. Select the caption and copy it manually.",
                      ),
                    );
                }}
              >
                Copy caption
              </Button>
            </div>
          ) : null}
        </div>
        <div className="editor-controls">
          <div className="editor-section-title">
            <SlidersHorizontal size={16} />
            <h3>Edit the words</h3>
          </div>
          {supportsVariations && (
            <HeadlineVariations key={v.id} assetId={asset.id} version={v} pending={pending || busy} onCreated={async (nextId, nextHeadline) => {
              await refresh();
              setVid(nextId);
              setHeadline(nextHeadline);
              setCta(v.cta);
              notify("Headline variations queued.");
            }} />
          )}
          <Field label="Headline">
            <textarea
              value={headline}
              disabled={busy}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={120}
              rows={3}
            />
          </Field>
          <Field label="Call to action">
            <input
              value={cta}
              disabled={busy}
              onChange={(e) => setCta(e.target.value)}
              maxLength={55}
            />
          </Field>
          <Field label="Post caption" hint="Saved with this asset and included in campaign downloads. Updating it replaces the caption for all versions of this asset.">
            <textarea value={caption} disabled={busy} onChange={event => setCaption(event.target.value)} maxLength={2200} rows={5} />
          </Field>
          <Button
            className="full"
            busy={operation === "edit"}
            disabled={busy || pending || v.status !== "ready" || !validCopy}
            onClick={() => void revise(false)}
          >
            Save a new version <span className="button-credit">Free edit</span>
          </Button>
          <small className="muted">
            Updates your headline, call to action and saved caption. The image stays the same.
          </small>
          <div className="editor-divider" />
          <Field
            label="Want a different creative?"
            hint={
              photoBackedImage
                ? "This creative uses your original product photo. Scene regeneration is not available for uploaded photos. You can edit the headline, call to action and caption above for free."
                : v.mock
                ? "Sample mode reuses the same photo and spends preview credits."
                : "Describe the visual changes. This creates a separately priced version."
            }
          >
            <textarea
              placeholder="Tell us what you’d like to change…"
              value={note}
              disabled={busy || pending || photoBackedImage}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </Field>
          <Button
            variant="secondary full"
            busy={operation === "generate"}
            disabled={busy || pending || photoBackedImage || !validCopy || !canAffordGeneration || regenLeft <= 0}
            onClick={() => void revise(true)}
          >
            {v.status === "failed" ? "Generate a new attempt" : v.mock ? "Generate sample version" : "Generate a new creative"} <span>{generationCost} credits</span>
          </Button>
          {!photoBackedImage && <p className="asset-credit-balance">{studio?.balance ?? 0} credits available{!canAffordGeneration ? ` · This generation needs ${generationCost - (studio?.balance ?? 0)} more credits.` : ""}</p>}
          {regenLeft <= 0 && studio?.videoRegen && <p className="asset-credit-balance" role="status">You've used all {studio.videoRegen.cap} video regenerations this month. They reset on {new Date(studio.videoRegen.resetsAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}.</p>}
          {!photoBackedImage && !canAffordGeneration && <Link className="text-link" to="/studio/billing">View billing <ArrowUpRight size={14} /></Link>}
          <details className="asset-prompt-details"><summary>View generation instructions</summary><h4>{asset.kind === "video" ? "First-frame prompt" : "Visual prompt"}</h4><p>{v.prompt}</p>{v.motion_prompt && <><h4>Motion prompt</h4><p>{v.motion_prompt}</p></>}</details>
          {error ? <Notice>{error}</Notice> : null}
          {(error || pending) && <Button variant="secondary small" busy={operation === "refresh"} disabled={busy} onClick={() => void refreshStatus()}>Refresh status</Button>}
        </div>
      </div>
      <div className="versions-heading">
        <h3>Version history</h3>
        <span>{asset.versions.length} {asset.versions.length === 1 ? "version" : "versions"}</span>
      </div>
      <div className="version-list">
        {asset.versions.map((version) => (
          <button
            key={version.id}
            className={v.id === version.id ? "selected" : ""}
            aria-pressed={v.id === version.id}
            disabled={busy}
            onClick={() => select(version)}
          >
            <strong>
              Version {version.n}
              {asset.current_version_id === version.id ? (
                <Check size={14} />
              ) : null}
            </strong>
            <Status status={version.status} />
            <small>{supportsVariations ? version.headline : version.note || "Initial generation"}</small>
            <small>{version.credit_cost === 0 ? "Free edit" : `${version.credit_cost} credits at creation`}</small>
            {asset.current_version_id === version.id && <small className="version-current-label">Selected for downloads</small>}
          </button>
        ))}
      </div>
      {studio?.exportReviewRequired && v.status === "ready" && <section className="export-review" aria-labelledby="export-review-heading">
        <h3 id="export-review-heading">Review before downloading</h3>
        {v.reviewed ? <p role="status">This saved version and caption have been reviewed. Changing the creative, caption or campaign link requires a new review.</p> : <>
          <p>Check the rendered creative, caption and campaign link. These checks record your review; they do not independently verify claims or certification.</p>
          {campaign?.brand.destinationUrl ? <p>Campaign link: <a href={campaign.brand.destinationUrl} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>{campaign.brand.destinationUrl}</a></p> : <p>No campaign link is saved.</p>}
          <fieldset disabled={busy || unsavedCopy}>
            <legend>Confirm each check for this version</legend>
            {exportChecks.map(([key, label]) => <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: "0.65rem", marginBlock: "0.65rem" }}>
              <input type="checkbox" checked={!!checks[key]} onChange={event => setChecks(previous => ({ ...previous, [key]: event.target.checked }))} style={{ width: "auto", marginTop: "0.2rem" }} />
              <span>{label}</span>
            </label>)}
          </fieldset>
          {unsavedCopy && <p role="status">Save your text and caption changes, then review the finished version.</p>}
          <Button variant="secondary" busy={operation === "review"} disabled={busy || unsavedCopy || !v.reviewFingerprint || !exportChecks.every(([key]) => checks[key])} onClick={() => void approveReview()}>Approve this version for download</Button>
        </>}
      </section>}
      <div className="editor-footer">
        <span className="muted">
          {v.mock
            ? "Sample creative · no provider charge"
            : `${v.credit_cost} credits`}
        </span>
        <div>
          {v.status === "ready" && v.id !== asset.current_version_id ? (
            <Button
              variant="secondary"
              busy={operation === "select"}
              disabled={busy}
              onClick={() => void makeCurrent()}
            >
              Use this version
            </Button>
          ) : null}
          {v.status === "ready" && (!studio?.exportReviewRequired || v.reviewed) ? (
            <a className="button" href={`${media(v.id)}?download=true`}>
              <Download size={16} />
              Download version {v.n}
            </a>
          ) : null}
        </div>
      </div>
    </>
  );
}
