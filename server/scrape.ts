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
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function safePage(
  input: string,
  redirects = 0,
): Promise<{ url: string; html: string }> {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new AppError(400, "Use a public HTTPS website address.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address)))
    throw new AppError(400, "Only public websites can be read.");
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: { "User-Agent": "InkshotReader/1.0", Accept: "text/html" },
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
          response.resume();
          if (redirects >= 3)
            return reject(
              new AppError(400, "That website redirected too many times."),
            );
          safePage(
            new URL(response.headers.location, url).href,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (
          response.statusCode !== 200 ||
          !response.headers["content-type"]?.includes("text/html")
        ) {
          response.resume();
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
          if (size > 1500000) {
            request.destroy(new Error("Page too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            url: url.href,
            html: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
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
  return pages.map((p) => {
    const d = cheerio.load(p.html);
    d("script,style,nav,footer,header,noscript,aside,form,svg,[role='navigation'],[aria-hidden='true']").remove();
    const main = d("main,[role='main'],article,#content").first();
    const readable = main.length ? main : d("body");
    return {
      url: p.url,
      title: d("title").text().slice(0, 200),
      text: readable.text().replace(/\s+/g, " ").trim().slice(0, 10000),
    };
  });
}
