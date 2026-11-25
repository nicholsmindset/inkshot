import { useEffect, useState } from "react";
import { api } from "./api";
import type { PlanInfo } from "../shared/types";

// Prices, credits and costs come from the server (/api/plan); nothing is hard-coded here.
export function formatPrice(plan: PlanInfo) {
  const amount = plan.priceAmount / 100;
  const locale = ({ usd: "en-US", cad: "en-CA", aud: "en-AU", sgd: "en-SG" } as Record<string, string>)[plan.currency] ?? "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency", currency: plan.currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
export function usePlan(fromStudio?: PlanInfo) {
  const [plan, setPlan] = useState<PlanInfo | undefined>(fromStudio);
  useEffect(() => {
    if (fromStudio) { setPlan(fromStudio); return; }
    void api<PlanInfo>("/plan").then(setPlan).catch(() => {});
  }, [fromStudio]);
  return plan;
}
