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
import { VERSION_CREDITS } from "../../shared/types";
const icons = { video: Film, image: Image, post: MessageSquare };
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
      <div><h1>{studio.brand.name}<em> studio</em></h1><p>Plan campaigns, review your ads and download approved versions.</p></div>
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
        const summary = assetCounts(studio.assets.filter((asset) => asset.campaign_id === campaign.id));
        return <Link key={campaign.id} to={`/studio/campaign/${campaign.id}`} className="campaign-row studio-campaign-row">
          <div className="campaign-icon"><FolderOpen size={21} /></div>
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
        <span>
          {asset.kind === "video"
            ? v.mock
              ? "5s preview"
              : "15 seconds"
            : asset.format}
        </span>
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
        <h3>{kind === "video" ? "Video ads · 15 seconds" : kind === "image" ? "Image ads" : "Organic posts"}</h3>
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
              {kind === "video" && <Field label="Motion prompt" hint="Describe what happens across the 15-second clip. The first frame sets the scene.">
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
        {draft.photoId && <figure><img src={"/api/uploads/" + encodeURIComponent(draft.photoId)} alt="Approved product photo" /><figcaption>Photo used for image ads and posts. Live video uses a generated first frame.</figcaption></figure>}
        {campaign.brand.logoId && <img src={"/api/uploads/" + campaign.brand.logoId} alt="Approved brand logo" />}
        <span>Brand colour <strong>{campaign.brand.color}</strong></span>
      </div>
      <div className="approval-panel">
        <div><h3>Approve your saved prompts</h3><label className="checkbox-label"><input type="checkbox" checked={approved === review} disabled={locked || dirty || saving || !validAssets || !!error}
          onChange={(event) => setApproved(event.target.checked ? review : "")} />I’ve checked the prompts, offer and claims, and approve these nine assets.</label></div>
        <div><Button busy={action === "generate"} disabled={locked || approved !== review || !validAssets || dirty || saving || !!error || !destinationValid || studio.balance < 100} onClick={() => void generate()}>Make my kit <span className="button-credit">100 credits</span></Button><small>{studio.balance} credits available</small></div>
      </div>
    </>}
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
              : `${done} of 9 assets ready. Each one gets its own finishing touches.`}
          </p>
        </div>
        {done ? (
          <a
            className="button secondary"
            href={`/api/campaigns/${id}/download`}
          >
            <Download size={17} />
            Download ready assets
          </a>
        ) : (
          <Status status={campaign.status} />
        )}
      </div>
      {campaign.mock ? (
        <div className="preview-banner">
          <Feather size={17} />
          <span>
            Sample campaign. Images use the sample or your uploaded photo;
            videos are 5-second still previews. No paid API calls.
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
                {done === 9
                  ? "Your kit is ready."
                  : "Good things are taking shape."}
              </span>
              <b>{done} / 9</b>
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
      description="Keep what works. Give the rest a little attention."
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

function EditorContents({ asset }: { asset: Asset }) {
  const { refresh, notify } = useStudio();
  const [vid, setVid] = useState(asset.current_version_id);
  const v = asset.versions.find((v) => v.id === vid) || asset.versions[0];
  const original = asset.versions.reduce((first, item) => item.n < first.n ? item : first);
  const supportsVariations = asset.kind === "image";
  const compare = supportsVariations && original.status === "ready" && v.id !== original.id;
  const [headline, setHeadline] = useState(v.headline);
  const [cta, setCta] = useState(v.cta);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = asset.versions.some((v) =>
    ["queued", "making", "rendering"].includes(v.status),
  );
  async function revise(regenerate: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ versionId: string }>(
        `/assets/${asset.id}/revise`,
        { versionId: v.id, headline, cta, note, regenerate },
      );
      await refresh();
      setVid(result.versionId);
      notify(
        regenerate
          ? "A fresh version is in the works."
          : "Your updated export is in the works.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function makeCurrent() {
    setBusy(true);
    try {
      await api(`/assets/${asset.id}/current`, { versionId: v.id }, "PUT");
      await refresh();
      notify("This is now your selected version.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function select(version: Version) {
    setVid(version.id);
    setHeadline(version.headline);
    setCta(version.cta);
  }
  return (
    <>
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
            <div className="editor-wait">
              <Status status={v.status} />
              {v.error ? <p>{v.error}</p> : <LoaderCircle className="spin" />}
            </div>
          )}
          {asset.caption ? (
            <div className="caption">
              <span className="eyebrow">YOUR CAPTION</span>
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
            <h3>Make it your own</h3>
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
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={120}
              rows={3}
            />
          </Field>
          <Field label="Call to action">
            <input
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              maxLength={55}
            />
          </Field>
          <Button
            className="full"
            busy={busy}
            disabled={
              pending || v.status !== "ready" || !headline.trim() || !cta.trim()
            }
            onClick={() => void revise(false)}
          >
            Save a new version <span className="button-credit">Free edit</span>
          </Button>
          <small className="muted">
            Updates the words in your downloaded file.
          </small>
          <div className="editor-divider" />
          <Field
            label="Want a different creative?"
            hint={
              v.mock
                ? "Preview mode reuses the same photo. Live creative revisions are not enabled yet."
                : "A new generation uses credits."
            }
          >
            <textarea
              placeholder="Tell us what you’d like to change…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </Field>
          <Button
            variant="secondary full"
            busy={busy}
            disabled={pending}
            onClick={() => void revise(true)}
          >
            Regenerate sample <span>{VERSION_CREDITS[asset.kind]} credits</span>
          </Button>
          {error ? <Notice>{error}</Notice> : null}
        </div>
      </div>
      <div className="versions-heading">
        <h3>Every version has a place.</h3>
        <span className="hand">keep the one that feels right.</span>
      </div>
      <div className="version-list">
        {asset.versions.map((version) => (
          <button
            key={version.id}
            className={v.id === version.id ? "selected" : ""}
            onClick={() => select(version)}
          >
            <strong>
              Version {version.n}
              {asset.current_version_id === version.id ? (
                <Check size={14} />
              ) : null}
            </strong>
            <Status status={version.status} />
            <small>{supportsVariations ? version.headline : version.note || "The original idea"}</small>
          </button>
        ))}
      </div>
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
              busy={busy}
              onClick={() => void makeCurrent()}
            >
              Use this version
            </Button>
          ) : null}
          {v.status === "ready" ? (
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
