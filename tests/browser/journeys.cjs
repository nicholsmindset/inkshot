// Playwright journeys: a new merchant on desktop (1280) and a 375 px phone, through signup,
// website-read recovery, brief, campaign, generation, review, download, billing and help.
// Usage: node tests/browser/journeys.cjs [origin] [screenshotDir]
// Needs a local server in mock mode, for example:
//   PORT=3001 APP_ORIGIN=http://127.0.0.1:3001 SUPPORT_EMAIL=help@example.test GENERATION_MODE=mock \
//   BILLING_MODE=sandbox ENABLE_EXPORT_REVIEW=true npx tsx server/index.ts
// Exits non-zero on any failed expectation or accessibility finding.
const { chromium } = require("playwright");
const fs = require("fs");
const origin = process.argv[2] || "http://127.0.0.1:3001";
const shots = process.argv[3] || "/tmp/inkshot-shots";
const problems = [];
const seenFindings = new Set();
fs.mkdirSync(shots, { recursive: true });

function expect(condition, message) { if (!condition) throw new Error(message); }

async function accessibilityAudit(page, label) {
  const found = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push("horizontal overflow");
    for (const e of document.querySelectorAll("input,select,textarea")) {
      if (e.type === "hidden") continue;
      if (!e.labels?.length && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby")) out.push(`unlabelled control ${e.name || e.type}`);
    }
    for (const e of document.querySelectorAll("button,a")) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && !(e.textContent || "").trim() && !e.getAttribute("aria-label") && !e.getAttribute("title")) out.push("button or link without a name");
    }
    // Text contrast (WCAG AA): composite backgrounds up the tree; skip anything over an image/gradient.
    const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
    const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const rules = [];
    const collect = list => { for (const r of list) { if (r.cssRules && r.media && !matchMedia(r.media.mediaText).matches) continue; if (r.style && r.style.color && r.selectorText) rules.push(r); else if (r.cssRules) collect(r.cssRules); } };
    for (const sheet of document.styleSheets) { try { collect(sheet.cssRules); } catch { /* cross-origin */ } }
    const ruleFor = el => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { let hit = null; for (const r of rules) { try { if (n.matches(r.selectorText)) hit = r; } catch { /* unsupported selector */ } } if (hit) return `${hit.selectorText} { color: ${hit.style.color} }`; } return "inherited"; };
    const seen = new Set();
    for (const e of document.querySelectorAll("body *")) {
      const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
      const rect = e.getBoundingClientRect();
      if (!own || rect.width === 0 || rect.height === 0) continue;
      if (e.matches(":disabled, :disabled *, [aria-disabled=true]")) continue; // inactive controls are exempt from WCAG contrast
      const style = getComputedStyle(e);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      let bg = { r: 255, g: 255, b: 255 }, layers = [], node = e, skip = false;
      while (node && node !== document.documentElement) {
        const s = getComputedStyle(node);
        if (s.backgroundImage !== "none") { skip = true; break; }
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
        node = node.parentElement;
      }
      if (skip) continue;
      for (const c of layers.reverse()) bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) };
      const fg = parse(style.color); if (!fg) continue;
      const fgc = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
      const [a, b] = [lum(fgc), lum(bg)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      const size = parseFloat(style.fontSize), large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) { const key = style.color + bg.r + e.className; if (!seen.has(key)) { seen.add(key); out.push(`low contrast ${ratio.toFixed(2)} ${style.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}) (${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${e.textContent.trim().slice(0, 24)}") RULE ${ruleFor(e)} NEED ${(4.5 / ratio).toFixed(2)}x`); } }
    }
    return out;
  });
  for (const finding of found) { const key = finding.replace(/\(.*$/, ""); if (!seenFindings.has(key)) { seenFindings.add(key); problems.push(`${label}/${page.url().split("/").slice(3, 5).join("/")}: ${finding}`); } }
}

async function run(label, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("dialog", d => d.accept());
  page.on("pageerror", e => problems.push(`${label}: page error: ${e.message.slice(0, 160)}`));
  page.on("console", m => { if (m.type() === "error" && !/401|400|Unauthorized|Bad Request/.test(m.text())) problems.push(`${label}: console error: ${m.text().slice(0, 140)}`); });
  const step = async (name, fn) => {
    try { await fn(); await page.waitForLoadState("networkidle").catch(() => {}); await accessibilityAudit(page, `${label}/${name}`); }
    catch (error) { problems.push(`${label}/${name}: FAILED ${error.message.split("\n")[0]}`); await page.screenshot({ path: `${shots}/${label}-${name}-FAILED.png`, fullPage: true }).catch(() => {}); throw error; }
    await page.screenshot({ path: `${shots}/${label}-${name}.png`, fullPage: true });
  };
  const go = path => page.goto(origin + path);

  await step("home", () => go("/"));
  await step("signup", async () => {
    await go("/signup");
    await page.fill("input[name=name]", "Journey Merchant");
    await page.fill("input[name=email]", `journey-${label}-${Date.now()}@example.test`);
    await page.fill("input[name=password]", "Inkshot-journey-2026!");
    // Keyboard: the submit button is reachable and shows a visible focus ring.
    await page.focus("input[name=password]"); await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    expect(outline !== "none", "keyboard focus has no visible outline on the submit button");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/studio/);
  });
  await step("help", async () => {
    await go("/help");
    expect(await page.getByRole("heading", { name: "How do credits work?" }).isVisible(), "help FAQ missing credits answer");
    expect(await page.getByText("help@example.test").first().isVisible(), "help page does not show the support email");
  });
  await step("brief-read-failure", async () => {
    await go("/studio/brand");
    await page.fill("input[placeholder='yourbusiness.com']", "https://nonexistent.invalid");
    await page.getByRole("button", { name: "Read my site" }).click();
    await page.getByText(/You can still continue/).waitFor();
    expect(await page.getByText(/could not find that website/).isVisible(), "read failure should explain the problem");
  });
  await step("brief-manual", async () => {
    await page.getByLabel("Business name").fill("Humble Bakes");
    await page.getByLabel(/What do you do/).fill("Home bakery selling cakes and cookies in Singapore.");
    await page.getByLabel(/Who is it for/).fill("Families planning birthdays and gatherings.");
    await page.getByLabel(/Your offer/).fill("Order by Friday for weekend delivery.");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/studio\/new/);
  });
  await step("angles", async () => {
    await go("/studio/new");
    await page.getByLabel("Give your campaign a name").fill("Weekend cakes");
    await page.getByLabel(/Customer-facing offer/).fill("Order by Friday for weekend delivery.");
    await page.getByRole("button", { name: "Find my campaign angles" }).click();
    await page.waitForURL(/\/studio\/campaign\//);
    await page.getByText("3 of 3 selected").waitFor();
  });
  await step("approval", async () => {
    await page.getByRole("button", { name: /Write my nine prompts/ }).click();
    await page.getByLabel("Campaign destination URL").fill("https://humblebakes.example.com/order");
    await page.getByLabel(/I’ve checked the prompts/).check();
    expect(await page.getByRole("button", { name: /Make my kit/ }).isEnabled(), "approval should enable the kit button");
    expect(await page.getByText(/100 credits/).first().isVisible(), "approval should show the credit cost");
  });
  await step("generation", async () => {
    await page.getByRole("button", { name: /Make my kit/ }).click();
    await page.getByText(/Your kit is ready/).waitFor({ timeout: 90000 });
  });
  await step("platform-copy", async () => {
    await page.getByRole("tab", { name: /TikTok/ }).click();
    await page.getByRole("button", { name: /Write TikTok copy/ }).click();
    await page.getByText(/Sample copy: shows the layout and limits/).waitFor();
    expect(await page.locator(".platform-variant").count() === 6, "TikTok copy should show 2 versions for each of the 3 angles");
    expect(await page.getByText(/AI disclosure/).first().isVisible(), "AI disclosure reminders missing");
    expect(await page.locator(".platform-field small").first().isVisible(), "character counts missing");
  });
  await step("review-and-download", async () => {
    await page.locator("a:has-text('Ready to use'), button:has-text('Ready to use')").first().click();
    await page.getByRole("button", { name: /Approve this version for download/ }).waitFor();
    for (const box of await page.locator("fieldset input[type=checkbox], .export-review input[type=checkbox]").all()) await box.check();
    await page.getByRole("button", { name: /Approve this version for download/ }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: /Download version 1/ }).click();
    await download;
    await page.getByText("Would you publish this?").waitFor();
    await page.getByRole("button", { name: "Yes, as is" }).click();
    await page.getByText(/Thanks, that helps/).waitFor();
  });
  await step("billing", async () => {
    await go("/studio/billing");
    const plan = (await (await page.request.get(origin + "/api/studio")).json()).plan; // the workspace's own currency
    const price = new Intl.NumberFormat({ usd: "en-US", cad: "en-CA", aud: "en-AU", sgd: "en-SG" }[plan.currency] || "en-US", { style: "currency", currency: plan.currency.toUpperCase(), minimumFractionDigits: Number.isInteger(plan.priceAmount / 100) ? 0 : 2 }).format(plan.priceAmount / 100);
    expect(await page.getByText(price).first().isVisible(), `billing page does not show the configured price ${price}`);
    expect(await page.getByText(/do not roll over/).first().isVisible(), "billing page should state there is no rollover");
  });
  await step("dashboard", () => go("/studio"));
  await step("library", () => go("/studio/library"));
  await step("settings", () => go("/studio/settings"));
  await step("terms", () => go("/terms"));
  await browser.close();
}

(async () => {
  let failed = false;
  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 375, height: 740 }]]) {
    try { await run(label, viewport); } catch { failed = true; }
  }
  if (problems.length) { console.log(problems.join("\n")); }
  console.log(problems.length ? `\n${problems.length} finding(s)` : "All journeys passed with no findings");
  process.exit(problems.length || failed ? 1 : 0);
})();
