import { useEffect, useState } from "react";
import { api } from "./api";
import type { PlanInfo } from "../shared/types";

// Prices, credits and costs come from the server (/api/plan); nothing is hard-coded here.
export function formatPrice(plan: PlanInfo) {
  const amount = plan.priceAmount / 100;
  return new Intl.NumberFormat("en-SG", {
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
