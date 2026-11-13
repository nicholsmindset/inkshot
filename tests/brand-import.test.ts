import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPage, importedIdentity } from "../server/scrape";
import { brandSchema, emptyBrand } from "../server/brand";

const url = "https://bakery.example/";
test("homepage metadata supplies merchant identity, source evidence, colour and a logo reference", () => {
  const home = extractPage({ url, html: `<html><head><title>Buy our buns | Bakery</title>
    <meta property="og:site_name" content="Pandan Bakery"><meta name="description" content="Fresh buns &amp; cakes.">
    <meta name="theme-color" content="#AbC"><script type="application/ld+json">{"@graph":[
    {"@type":"Organization","name":"Fallback","logo":{"url":"/brand.svg"}}]}</script></head>
    <body><nav>Skip menu</nav><main><h1>Our bakes</h1><p>Fresh <strong>buns</strong></p><p>Order today</p></main></body></html>` });
  const brand = importedIdentity([home]);
  assert.equal(brand.name, "Pandan Bakery");
  assert.equal(brand.description, "Fresh buns & cakes.");
  assert.equal(brand.color, "#aabbcc");
  assert.equal(brand.logoUrl, "https://bakery.example/brand.svg");
  assert.equal(home.text, "Our bakes Fresh buns Order today");
  assert.equal(brand.sources[0].url, url);
  assert(brand.sources[0].text.includes("Fresh buns & cakes."));
  assert(brandSchema.safeParse({ ...emptyBrand, ...brand }).success);
});

test("reads Organization or WebSite identity, ignoring malformed metadata and unsafe logo references", () => {
  const page = extractPage({ url, html: `<title>Order</title><script type="application/ld+json">{bad</script>
    <script type="application/ld+json">[{"@type":"WebSite","name":"Site name"},
    {"@type":["Organization"],"name":"The Bakery","logo":"https://unrelated.example/logo.svg"}]</script>
    <meta name="theme-color" content="invalid"><header><img alt="Brand logo" src="/logo.png"></header>
    <main><p>First</p><p>Second</p></main>` });
  assert.equal(page.siteName, "The Bakery");
  assert.equal(page.color, "");
  assert.equal(page.logoUrl, url + "logo.png");
  const site = extractPage({ url, html: '<script type="application/ld+json">{"@type":"WebSite","name":"Bun Club"}</script><p>Local bakes</p>' });
  assert.equal(importedIdentity([site]).name, "Bun Club");
  assert.equal(importedIdentity([site]).description, "Local bakes");
  assert(!brandSchema.safeParse({ ...emptyBrand, website: url, logoUrl: "https://other.example/x" }).success);
});
