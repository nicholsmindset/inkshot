import type { ReactNode, ButtonHTMLAttributes } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, LoaderCircle, ArrowUpRight, Check } from "lucide-react";
export function Button({
  children,
  busy = false,
  variant = "",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: string;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${className}`}
    >
      {busy ? <LoaderCircle size={17} className="spin" /> : null}
      {children}
    </button>
  );
}
export function BrandMark() {
  return (
    <span className="wordmark">
      inkshot<span className="logo-dot">.</span>
    </span>
  );
}
export function Highlight({ children }: { children: ReactNode }) {
  return <span className="highlight">{children}</span>;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="alert">
      {children}
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal">
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={21} />
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="muted">
              {description}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Status({ status }: { status: string }) {
  const labels: Record<string, string> = {
    ready: "Ready to use",
    draft: "Concepts ready",
    generating: "Making your kit",
    queued: "In the queue",
    making: "Making",
    rendering: "Finishing touches",
    failed: "Needs attention",
    partial: "Partly ready",
  };
  return (
    <span className={`status ${status}`}>
      {status === "ready" ? <Check size={12} /> : null}
      {labels[status] || status}
    </span>
  );
}
export function Empty({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function ExternalArrow() {
  return <ArrowUpRight size={18} />;
}
