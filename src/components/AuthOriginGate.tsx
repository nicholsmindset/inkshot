import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { canonicalAuthDestination } from "../auth-origin";
import { BrandMark, Button, Notice } from "../ui";

export function AuthOriginGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void api<{ origin: string | null }>("/auth/config").then(({ origin }) => {
      if (!active) return;
      const destination = canonicalAuthDestination(origin, window.location.href);
      if (destination) window.location.replace(destination);
      else setReady(true);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [attempt]);
  if (ready) return <>{children}</>;
  return <main className="auth-page"><div className="auth-form"><BrandMark />
    {error ? <><Notice>{error}</Notice><Button onClick={() => setAttempt(a => a + 1)}>Try sign-in setup again</Button></>
      : <p role="status">Opening secure sign-in…</p>}
  </div></main>;
}
