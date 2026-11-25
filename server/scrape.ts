import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import * as cheerio from "cheerio";
import { AppError } from "./config.js";
export function isPublicIp(address: string) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    // ::/96 (IPv4-compatible) addresses are never public; parse() reports some of them as unicast.
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).parts.slice(0, 6).every(part => part === 0)) return false;
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
type ResourcePolicy = { types: string[]; maxBytes: number; origin?: string };

async function fetchPublicResource(input: string, policy: ResourcePolicy, redirects = 0):
  Promise<{ url: string; bytes: Buffer; type: string }> {
  const url = new URL(input);
  if (
    (policy.origin && url.origin !== policy.origin) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new AppError(400, "Use a public HTTPS website address.");
  let addresses: import("node:dns").LookupAddress[];
  try { addresses = await lookup(url.hostname, { all: true }); }
  catch { throw new AppError(400, "We could not find that website. Check the address, or add your details manually."); }
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address)))
    throw new AppError(400, "Only public websites can be read.");
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: { "User-Agent": "InkshotReader/1.0", Accept: policy.types.join(", ") },
        lookup: ((_host: unknown, options: { all?: boolean }, cb: Function) =>
          options.all
            ? cb(null, [selected])
            : cb(null, selected.address, selected.family)) as never,
        timeout: 10000,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.destroy();
          if (redirects >= 3)
            return reject(
              new AppError(400, "That website redirected too many times."),
            );
          try {
            const next = new URL(response.headers.location, url);
            fetchPublicResource(next.href, policy, redirects + 1).then(resolve, reject);
          } catch (error) { reject(error); }
          return;
        }
        const type = (response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (response.statusCode !== 200 || !policy.types.includes(type)) {
          response.destroy();
          reject(
            new AppError(
              400,
              "We could not read that page. Try your homepage or add your details manually.",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > policy.maxBytes) {
            request.destroy(new Error("Page too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            url: url.href,
            bytes: Buffer.concat(chunks), type,
          }),
        );
        response.on("error", reject);
      },
    );
    const deadline = setTimeout(() => request.destroy(new Error("Resource took too long")), 10000);
    request.once("close", () => clearTimeout(deadline));
    request.on("timeout", () =>
      request.destroy(new Error("Website took too long to respond")),
    );
    request.on("error", () =>
      reject(
        new AppError(
          400,
          "We could not read that page. Try your homepage or add your details manually.",
        ),
      ),
    );
  });
}
export async function safePage(input: string, redirects = 0) {
  const result = await fetchPublicResource(input, { types: ["text/html"], maxBytes: 1500000 }, redirects);
  return { url: result.url, html: result.bytes.toString("utf8") };
}

export async function fetchSiteLogo(website: string, logoUrl: string) {
  return fetchPublicResource(logoUrl, {
    origin: new URL(website).origin,
    types: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
    maxBytes: 2 * 1024 * 1024,
  });
}

function clean(value: unknown, max = 1000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function explicitColor(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value))
    return "#" + [...value.slice(1)].map(c => c.repeat(2)).join("").toLowerCase();
  return "";
}

function logoReference(value: unknown, page: URL) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return "";
  try {
    const target = new URL(value, page);
    return target.protocol === "https:" && target.origin === page.origin &&
      !target.username && !target.password ? target.href : "";
  } catch {
    return "";
  }
}

export function extractPage(page: { url: string; html: string }) {
  const $ = cheerio.load(page.html);
  const url = new URL(page.url);
  let organization = "", site = "", logoUrl = "";
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      const parsed = JSON.parse($(script).text());
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      for (const root of roots) {
        const nodes = [root, ...(Array.isArray(root?.["@graph"]) ? root["@graph"] : [])];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const types = [node["@type"]].flat();
          if (types.includes("WebSite")) site ||= clean(node.name, 100);
          if (types.some(t => ["Organization", "LocalBusiness", "Bakery", "Store", "Restaurant"].includes(t))) {
            organization ||= clean(node.name, 100);
            logoUrl ||= logoReference(typeof node.logo === "string" ? node.logo : node.logo?.url || node.logo?.contentUrl, url);
          }
        }
      }
    } catch {
      // A malformed block should not hide normal HTML metadata.
    }
  });
  if (!logoUrl) {
    const logo = $('header img[alt*="logo" i], header img[class*="logo" i], header img[itemprop="logo"]').first();
    logoUrl = logoReference(logo.attr("src"), url);
  }
  const meta = (selector: string) => clean($(selector).first().attr("content"));
  const siteName = meta('meta[property="og:site_name" i]').slice(0, 100) || organization || site;
  const description = meta('meta[name="description" i]') || meta('meta[property="og:description" i]');
  const color = explicitColor(meta('meta[name="theme-color" i]:not([media])'));
  const title = clean($("title").first().text(), 200);
  $("script,style,nav,footer,header,noscript,aside,form,svg,[role='navigation'],[aria-hidden='true']").remove();
  $("p,div,li,h1,h2,h3,h4,h5,h6,article,section,td,th,figcaption,dt,dd,br").before(" ").after(" ");
  const main = $("main,[role='main'],article,#content").first();
  const body = main.length ? main : $("body");
  return { url: url.href, title, siteName, description, color, logoUrl, text: clean(body.text(), 10000) };
}

export function importedIdentity(pages: ReturnType<typeof extractPage>[]) {
  const home = pages[0];
  const name = home.siteName || home.title.split(/[|–—]/)[0].trim().slice(0, 100) || "My business";
  return {
    name, website: home.url, description: home.description || home.text.slice(0, 1000),
    ...(home.color ? { color: home.color } : {}),
    ...(home.logoUrl ? { logoUrl: home.logoUrl } : {}),
    sources: pages.map(p => ({
      url: p.url, text: [p.siteName, p.description, p.text].filter(Boolean).join(" · ").slice(0, 600),
    })),
  };
}

export async function scrape(input: string) {
  const first = await safePage(input);
  const $ = cheerio.load(first.html);
  const origin = new URL(first.url).origin;
  const urls = [
    ...new Set(
      $("a[href]")
        .map((_, a) => {
          try {
            const url = new URL($(a).attr("href")!, first.url);
            return url.origin === origin &&
              /about|pricing|product|services/.test(url.pathname)
              ? url.href
              : "";
          } catch {
            return "";
          }
        })
        .get()
        .filter(Boolean),
    ),
  ].slice(0, 3);
  const extra = await Promise.allSettled(urls.map((url) => safePage(url)));
  const pages = [
    first,
    ...extra.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
  ];
  return pages.map(extractPage);
}
