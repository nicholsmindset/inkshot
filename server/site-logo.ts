import "./render-fonts.js";
import * as cheerio from "cheerio";
import sharp from "sharp";
import { AppError } from "./config.js";

const invalid = () => new AppError(400, "This site logo could not be imported. Upload a PNG, JPG or WebP instead.");
const numeric = /^\d{1,4}(?:\.\d{1,4})?$/;
const color = /^(?:#[a-f\d]{3}(?:[a-f\d]{3})?|white|black|none)$/i;
const allowed: Record<string, Record<string, RegExp>> = {
  svg: { xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/, width: numeric, height: numeric, viewBox: /^0 0 \d{1,4} \d{1,4}$/ },
  rect: { x: numeric, y: numeric, rx: numeric, ry: numeric, width: numeric, height: numeric, fill: color },
  text: { x: numeric, y: numeric, fill: color, "text-anchor": /^(start|middle|end)$/, "font-weight": /^(?:[1-9]00|bold|normal)$/, "font-size": numeric, "font-family": /^[a-z ,\-]{1,60}$/i },
};

// Rebuild only flat rectangle/text logos. No untrusted SVG bytes reach the rasterizer.
function simpleSvg(bytes: Buffer) {
  const source = bytes.toString("utf8");
  if (bytes.length > 32768 || /<!|<\?|&/.test(source)) throw invalid();
  const $ = cheerio.load(source, { xml: true });
  const root = $.root().children();
  if (root.length !== 1 || root[0].name !== "svg") throw invalid();
  const elements = root.children();
  if (!elements.length || elements.length > 40 || root.find("*").length !== elements.length) throw invalid();
  const markup = (node: typeof root[0]) => {
    const rules = allowed[node.name];
    if (!rules || !Object.hasOwn(allowed, node.name)) throw invalid();
    const attrs = Object.entries(node.attribs).map(([key, value]) => {
      if (!Object.hasOwn(rules, key) || !rules[key].test(value)) throw invalid();
      return key + '="' + value + '"';
    });
    return "<" + node.name + " " + attrs.join(" ") + ">";
  };
  const width = Number(root.attr("width")), height = Number(root.attr("height"));
  if (width < 1 || height < 1 || !Number.isFinite(width * height) || width * height > 4000000) throw invalid();
  const parts = [markup(root[0])];
  for (const node of elements.toArray()) {
    if (node.name !== "text" && node.name !== "rect") throw invalid();
    const text = $(node).text();
    if (node.name === "rect" ? text.trim() !== "" : !/^[\p{L}\p{N} .,+-]{1,80}$/u.test(text)) throw invalid();
    parts.push(markup(node) + text + "</" + node.name + ">");
  }
  return Buffer.from(parts.join("") + "</svg>");
}

export async function rasterizeSiteLogo(bytes: Buffer, type: string) {
  try {
    const svg = type === "image/svg+xml";
    if (!svg) {
      const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp = bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
      if (!(type === "image/png" && png || type === "image/jpeg" && jpeg || type === "image/webp" && webp)) throw invalid();
    }
    return await sharp(svg ? simpleSvg(bytes) : bytes, { limitInputPixels: 4000000 })
      .rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .png().toBuffer();
  } catch { throw invalid(); }
}
