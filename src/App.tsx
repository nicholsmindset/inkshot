import { useEffect, useRef, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  NavLink,
  Outlet,
  Link,
  useNavigate,
} from "react-router-dom";
import {
  LayoutGrid,
  Plus,
  Palette,
  FolderOpen,
  ReceiptText,
  Settings,
  LogOut,
  Menu,
  X,
  Feather,
  ArrowUpRight,
} from "lucide-react";
import { StudioProvider, useStudio } from "./context";
import { BrandMark, Button, Notice } from "./ui";
import { api } from "./api";
import { brandDraftKey, clearBrandDraft } from "./brand-draft";
import { PasswordRecovery } from "./pages/PasswordRecovery";
import { Landing, Auth } from "./pages/Public";
import { Dashboard, Library, CampaignDetail } from "./pages/Studio";
import { BrandPage, NewCampaign } from "./pages/Create";
import { TrustPage, TrustLinks } from "./pages/Trust";
import { Billing, SettingsPage } from "./pages/Account";
function Shell() {
  const { studio, loading, error, refresh, clearSession } = useStudio();
  const [mobile, setMobile] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!mobile) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobile(false);
      mobileToggle.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !sidebar.current?.contains(event.target) && !mobileToggle.current?.contains(event.target)) setMobile(false);
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [mobile]);
  if (signedOut) return <Navigate to="/" replace />;
  if (loading)
    return (
      <div className="page-loading">
        <BrandMark />
        <span>Opening your studio…</span>
      </div>
    );
  if (!studio && error)
    return (
      <div className="page-loading">
        <BrandMark />
        <Notice>{error}</Notice>
        <Button onClick={() => void refresh()}>
          Try opening your studio again
        </Button>
      </div>
    );
  if (!studio) return <Navigate to="/login" replace />;
  async function logout() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await api("/auth/logout", {});
      try { clearBrandDraft(window.sessionStorage, brandDraftKey(studio!.user.id, studio!.user.workspaceId)); } catch { /* Storage may be blocked. */ }
      setSignedOut(true);
      clearSession();
      navigate("/", { replace: true });
    } catch (e) {
      setSignOutError((e as Error).message);
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="mobile-header">
        <Link to="/studio">
          <BrandMark />
        </Link>
        <button
          ref={mobileToggle}
          className="icon-button"
          aria-label={mobile ? "Close navigation" : "Open navigation"}
          aria-expanded={mobile}
          aria-controls="studio-sidebar"
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X /> : <Menu />}
        </button>
      </header>
      <aside ref={sidebar} id="studio-sidebar" className={`sidebar ${mobile ? "open" : ""}`}>
        <Link to="/studio" className="sidebar-logo">
          <BrandMark />
        </Link>
        <div className="workspace-name">
          <span className="brand-initial">{studio.brand.name[0]}</span>
          <div>
            <strong>{studio.brand.name}</strong>
            <small>Your creative studio</small>
          </div>
        </div>
        <nav aria-label="Main navigation" onClick={(event) => {
          if (mobile && event.target instanceof Element && event.target.closest("a")) {
            setMobile(false);
            requestAnimationFrame(() => document.getElementById("main")?.focus());
          }
        }}>
          <NavLink end to="/studio">
            <LayoutGrid />
            Overview
          </NavLink>
          <NavLink to="/studio/new">
            <Plus />
            New campaign<span className="nav-plus">+</span>
          </NavLink>
          <NavLink to="/studio/library">
            <FolderOpen />
            Asset library
          </NavLink>
          <NavLink to="/studio/brand">
            <Palette />
            Your brand
          </NavLink>
          <span className="nav-divider" />
          <NavLink to="/studio/billing">
            <ReceiptText />
            Usage & billing
          </NavLink>
          <NavLink to="/studio/settings">
            <Settings />
            Settings
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="credit-card">
            <div>
              <Feather size={16} />
              <strong>Room to create</strong>
            </div>
            <p>
              <b>{studio.balance}</b> credits available
            </p>
            <div className="credit-track">
              <i style={{ width: `${Math.min(100, studio.balance / 3)}%` }} />
            </div>
            <Link to="/studio/billing">
              View your plan <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="user-row">
            <span className="avatar">{studio.user.name.slice(0, 1)}</span>
            <div>
              <strong>{studio.user.name}</strong>
              <small>
                {studio.mode === "mock"
                  ? "Preview workspace"
                  : "Studio account"}
              </small>
            </div>
            <button
              className="icon-button"
              onClick={() => void logout()}
              aria-label={signingOut ? "Signing out" : "Sign out"}
              disabled={signingOut}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <div className="topbar">
          <span>
            <span className="tiny-dot" />A little creativity goes a long way.
          </span>
          <span className="preview-tag">
            {studio.mode === "mock"
              ? "Preview mode · no charges"
              : "Live generation"}
          </span>
        </div>
        <main id="main" tabIndex={-1}>
          {error ? (
            <Notice>
              {error}{" "}
              <Button variant="small" onClick={() => void refresh()}>
                Retry
              </Button>
            </Notice>
          ) : null}
          {signOutError && <Notice>{signOutError} <Button variant="small" busy={signingOut} onClick={() => void logout()}>Try signing out again</Button></Notice>}
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>Made for the businesses that care.</span>
          <TrustLinks />
        </footer>
      </div>
    </div>
  );
}
export default function App() {
  return (
    <StudioProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/privacy" element={<TrustPage kind="privacy" />} />
        <Route path="/terms" element={<TrustPage kind="terms" />} />
        <Route path="/ai-notice" element={<TrustPage kind="ai" />} />
        <Route path="/login" element={<Auth key="login" />} />
        <Route path="/forgot-password" element={<PasswordRecovery key="request" />} />
        <Route path="/reset-password" element={<PasswordRecovery key="reset" reset />} />
        <Route path="/signup" element={<Auth key="signup" signup />} />
        <Route path="/studio" element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="new" element={<NewCampaign />} />
          <Route path="brand" element={<BrandPage />} />
          <Route path="library" element={<Library />} />
          <Route path="campaign/:id" element={<CampaignDetail />} />
          <Route path="billing" element={<Billing />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StudioProvider>
  );
}
