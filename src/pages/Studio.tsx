import { useRef, useState } from "react";
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
import { Button, Highlight, Empty, Status, Modal, Field, Notice } from "../ui";
import { api, media } from "../api";
import type { Asset, Version } from "../../shared/types";
import { VERSION_CREDITS } from "../../shared/types";
const icons = { video: Film, image: Image, post: MessageSquare };
export function Dashboard() {
  const { studio } = useStudio();
  if (!studio) return null;
  const ready = studio.assets.filter((a) =>
    a.versions.some((v) => v.status === "ready"),
  ).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR CREATIVE CORNER</span>
          <h1>
            A good day to{" "}
            <Highlight>
              <em>make something.</em>
            </Highlight>
          </h1>
          <p>Your story, a few fresh ideas, and a little room to create.</p>
        </div>
        <Link to="/studio/new" className="button">
          <Plus size={17} />
          New campaign
        </Link>
      </div>
      <section className="welcome-panel">
        <div className="welcome-content">
          <span className="pill">YOUR NEXT CAMPAIGN</span>
          <h2>
            Big ideas.
            <br />
            <em>Small-business energy.</em>
          </h2>
          <p>
            Turn your brand into three videos, three image ads and three posts.
            All from one thoughtful brief.
          </p>
          <Link
            to={studio.brand.description ? "/studio/new" : "/studio/brand"}
            className="button"
          >
            {studio.brand.description
              ? "Start with an idea"
              : "Set up your brand"}
            <ArrowUpRight size={17} />
          </Link>
          <span className="hand welcome-note">
            nine little ways to stand out.
          </span>
        </div>
        <div className="welcome-example">
          <img
            src={
              studio.brand.photoId
                ? `/api/uploads/${studio.brand.photoId}`
                : "/examples/candle.png"
            }
            alt="Sample campaign photography"
          />
          <div>
            <span>{studio.brand.name.toUpperCase()}</span>
            <h3>
              Make room
              <br />
              for good things.
            </h3>
            <small>Sample creative</small>
          </div>
          <span className="tape" />
        </div>
        <span className="hand welcome-side">a little inspiration ↙</span>
      </section>
      <div className="stats-row">
        <div>
          <span>Available credits</span>
          <strong>
            {studio.balance}
            <small>{studio.mode === 'live' ? 'available for generation' : '/ 300 preview credits'}</small>
          </strong>
          <p>100 credits makes a complete kit</p>
        </div>
        <div>
          <span>Campaigns started</span>
          <strong>
            {studio.campaigns.length.toString().padStart(2, "0")}
            <small>ideas in motion</small>
          </strong>
          <p>One brand, a fresh perspective</p>
        </div>
        <div>
          <span>Assets ready</span>
          <strong>
            {ready.toString().padStart(2, "0")}
            <small>ready to download</small>
          </strong>
          <p>Every version has a home</p>
        </div>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">ON YOUR DESK</span>
          <h2>Recent campaigns</h2>
        </div>
        <Link className="text-link" to="/studio/library">
          Open library <ArrowUpRight size={15} />
        </Link>
      </div>
      {studio.campaigns.length ? (
        <div className="campaign-list">
          {studio.campaigns.slice(0, 4).map((c) => (
            <Link
              key={c.id}
              to={`/studio/campaign/${c.id}`}
              className="campaign-row"
            >
              <div className="campaign-icon">
                <Feather size={21} />
              </div>
              <div>
                <strong>{c.name}</strong>
                <small>
                  {c.goal} ·{" "}
                  {new Date(c.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </small>
              </div>
              <Status status={c.status} />
              <ArrowUpRight size={18} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="first-campaign">
          <div className="dashed-icon">
            <FolderOpen size={28} />
          </div>
          <div>
            <h3>Your first good idea belongs here.</h3>
            <p>Start a campaign and give your brand something new to say.</p>
          </div>
          <Link className="button secondary" to="/studio/new">
            Create your first campaign
            <Plus size={16} />
          </Link>
        </div>
      )}
      <div className="studio-note">
        <Feather size={19} />
        <span>A note from the studio</span>
        <p>
          The best ads still sound like you. Check your brief, keep what feels
          right, and make it your own.
        </p>
        <Link to="/studio/brand">
          Your brand brief <ArrowUpRight size={15} />
        </Link>
      </div>
    </>
  );
}
export function AssetCard({
  asset,
  onOpen,
}: {
  asset: Asset;
  onOpen: () => void;
}) {
  const v =
    asset.versions.find((v) => v.id === asset.current_version_id) ||
    asset.versions[0];
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
                ? "Let’s try that again."
                : "A little work in progress."}
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
  const [selected, setSelected] = useState<string | null>(null);
  if (!studio) return null;
  const assets = studio.assets.filter(
    (a) =>
      (filter === "all" || a.kind === filter) &&
      a.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE KEEPERS & THE POSSIBILITIES</span>
          <h1>
            Your{" "}
            <Highlight>
              <em>asset library.</em>
            </Highlight>
          </h1>
          <p>A home for your ideas. And every version along the way.</p>
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
            placeholder="Find something good…"
            aria-label="Search assets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
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
              ? "Nothing matches just yet."
              : "A blank page. Full of possibility."
          }
          description={
            studio.assets.length
              ? "Try another search or asset type."
              : "Your campaign videos, images and posts will live here."
          }
        >
          <Link to="/studio/new" className="button">
            Make your first kit <Plus size={17} />
          </Link>
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

function CampaignScreen({ id, workspaceId }: { id: string; workspaceId: string }) {
  const storageKey = "inkshot:campaign-draft:" + workspaceId + ":" + id;
  const [edits, setEdits] = useState<Record<string, string>>(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "string"));
    } catch {
      return {};
    }
  });
  const [storageAvailable, setStorageAvailable] = useState(true);
  const { studio, refresh, notify } = useStudio();
  const [approved, setApproved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const drafts = campaign.concepts.flatMap((concept) =>
    draftKinds.map((kind) => ({
      conceptId: concept.id,
      kind,
      cta: (edits[concept.id + ":" + kind] ?? concept.cta).trim(),
    })),
  );
  const photoId = campaign.mock ? studio.brand.photoId : undefined;
  const review = JSON.stringify({ drafts, photoId });
  function editCta(key: string, value: string) {
    const next = { ...edits, [key]: value };
    setEdits(next);
    setApproved("");
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }
  async function generate() {
    setBusy(true);
    setError("");
    try {
      await api(`/campaigns/${id}/generate`, { approved: true, drafts, photoId });
      await refresh();
      try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
      notify("Your kit is on its way. You can leave this page.");
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
          <span className="eyebrow">
            {campaign.goal.toUpperCase()} CAMPAIGN
          </span>
          <h1>{campaign.name}</h1>
          <p>
            {campaign.status === "draft"
              ? "Three angles. One unmistakably you campaign."
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
        <>
          <div className="section-heading">
            <h2>Review your nine assets</h2>
          </div>
          <p>{storageAvailable ? "Call-to-action edits are saved in this browser tab." : "Browser storage is unavailable. Keep this tab open to retain edits."}</p>
          <div className="concept-grid">
            {campaign.concepts.map((concept) => (
              <article className="concept-card" key={concept.id}>
                <h3>{concept.title}</h3>
                <h2>{concept.hook}</h2>
                <p>{concept.description}</p>
                {draftKinds.map((kind) => {
                  const key = concept.id + ":" + kind;
                  return (
                    <Field key={key} label={draftLabels[kind] + " call to action"}>
                      <input
                        aria-label={concept.title + " " + draftLabels[kind] + " call to action"}
                        value={edits[key] ?? concept.cta}
                        disabled={busy}
                        maxLength={55}
                        onChange={(event) => editCta(key, event.target.value)}
                      />
                    </Field>
                  );
                })}
              </article>
            ))}
          </div>
          {photoId && (
            <figure>
              <img src={"/api/uploads/" + encodeURIComponent(photoId)} alt="Brand photo selected for this sample campaign" width={120} />
              <figcaption>Photo for this sample kit</figcaption>
            </figure>
          )}
          <div className="approval-panel">
            <div>
              <h3>A quick check before we make it.</h3>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={approved === review}
                  disabled={busy}
                  onChange={(e) => setApproved(e.target.checked ? review : "")}
                />
                I’ve checked the concepts and confirmed that the offer and
                claims are accurate.
              </label>
            </div>
            <div>
              <Button
                disabled={approved !== review || drafts.length !== 9 || drafts.some((draft) => !draft.cta || draft.cta.length > 55) || studio.balance < 100}
                busy={busy}
                onClick={() => void generate()}
              >
                Make my kit <span className="button-credit">100 credits</span>
              </Button>
              <small>
                {studio.balance} credits available · 9 finished assets
              </small>
            </div>
          </div>
          {error ? <Notice>{error}</Notice> : null}
        </>
      ) : (
        <>
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
  const valid = headlines.length >= 2 && headlines.length <= 5 &&
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
      <Field label="Try different headlines" hint="Enter 2–5 distinct headlines, one per line. Up to 120 characters each. Each version keeps the image and call to action.">
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
