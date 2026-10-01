export type Brand = {
  name: string;
  website: string;
  description: string;
  audience: string;
  voice: string;
  offer: string;
  color: string;
  proof: string[];
  sources: { url: string; text: string }[];
  photoId?: string;
};
export type User = {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  demo: boolean;
};
export type Concept = {
  id: string;
  title: string;
  hook: string;
  description: string;
  cta: string;
};
export type Campaign = {
  id: string;
  name: string;
  goal: string;
  offer: string;
  status: string;
  concepts: Concept[];
  created_at: string;
  mock: boolean;
};
export type Version = {
  id: string;
  asset_id: string;
  n: number;
  status: string;
  prompt: string;
  headline: string;
  cta: string;
  note: string;
  credit_cost: number;
  error?: string;
  file_path?: string;
  preview_path?: string;
  created_at: string;
  mock: boolean;
};
export type Asset = {
  id: string;
  campaign_id: string;
  kind: "video" | "image" | "post";
  title: string;
  format: string;
  caption: string;
  current_version_id: string;
  versions: Version[];
};
export type Ledger = {
  id: string;
  amount: number;
  kind: string;
  description: string;
  created_at: string;
};
export type Studio = {
  user: User;
  brand: Brand;
  campaigns: Campaign[];
  assets: Asset[];
  balance: number;
  ledger: Ledger[];
  mode: "mock" | "live";
  providers: { higgsfield: boolean; claude: boolean };
  billingEnabled: boolean;
  billingStatus: string;
};
export const KIT_CREDITS = 100;
export const PLAN = {
  name: "Studio",
  price: 39,
  currency: "USD",
  kits: 3,
  credits: 300,
};
export const VERSION_CREDITS = { video: 26, image: 5, post: 2 } as const;
