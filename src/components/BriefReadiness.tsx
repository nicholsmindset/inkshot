import { Link } from "react-router-dom";
import type { Brand } from "../../shared/types";

export function BriefReadiness({ brand, editLink = false }: { brand: Brand; editLink?: boolean }) {
  const checks = [
    { label: "Business description", ready: !!brand.description.trim(), hint: "Explain what you sell and why it matters." },
    { label: "Customer", ready: !!brand.audience.trim(), hint: "Name the people this campaign should speak to." },
    { label: "Customer need", ready: !!brand.pain?.trim(), hint: "Describe the problem or desire behind a purchase." },
    { label: "Visual direction", ready: !!brand.visualDirection?.trim(), hint: "Choose the setting, mood and details to show." },
    { label: "Product or service photo", ready: !!brand.photoId, hint: "Add a photo you own to keep the result recognisable." },
  ];
  const missing = checks.filter(check => !check.ready);
  return <section className="brief-readiness" aria-label="Brief readiness">
    <div><h2>{missing.length ? "Give your campaign a stronger starting point" : "Your brief has the essentials"}</h2>
      <p>{checks.length - missing.length} of {checks.length} essentials added. This checks completeness, not accuracy. Review every fact.</p></div>
    {missing.length > 0 && <ul>{missing.map(check => <li key={check.label}><strong>{check.label}</strong><span>{check.hint}</span></li>)}</ul>}
    {editLink && missing.length > 0 && <Link className="button secondary" to="/studio/brand">Complete your brief</Link>}
  </section>;
}
