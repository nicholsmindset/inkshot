import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStudio } from "../context";
import { api } from "../api";
import { BrandMark, Button, Field, Notice } from "../ui";

export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const [params] = useSearchParams();
  const { clearSession } = useStudio();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    if (reset && fields.password !== fields.confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (reset) {
        await api("/auth/reset-password", { password: fields.password });
        clearSession();
      }
      else await api("/auth/forgot-password", { email: fields.email });
      form.reset();
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <main className="auth-page">
    <div className="auth-form">
      <Link to="/"><BrandMark /></Link>
      <div>
        <h1>{reset ? "Choose a new password" : "Reset your password"}</h1>
        {done ? <p role="status">{reset ? "Your password has been updated. Sign in with your new password." :
          "If there is an account for that email, you’ll receive a recovery link. Open it in this browser."}</p> :
          <form onSubmit={submit}>
            {!reset && params.has("expired") && <Notice>This link is invalid or expired. Request a new one and open it in this browser.</Notice>}
            {reset ? <>
              <Field label="New password" hint="At least 12 characters."><input name="password" type="password" autoComplete="new-password" disabled={busy} minLength={12} maxLength={128} required /></Field>
              <Field label="Confirm new password"><input name="confirmation" type="password" autoComplete="new-password" disabled={busy} maxLength={128} required /></Field>
            </> : <Field label="Account email address"><input name="email" type="email" autoComplete="email" disabled={busy} maxLength={254} required /></Field>}
            {error && <Notice>{error}</Notice>}
            <Button className="full" busy={busy}>{reset ? "Save new password" : "Email recovery link"}</Button>
          </form>}
        {reset && !done && <p className="auth-switch"><Link to="/forgot-password">Request another recovery link</Link></p>}
        <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
      </div>
    </div>
  </main>;
}
