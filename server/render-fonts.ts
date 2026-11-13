import path from "node:path";

// The hosted Sharp/libvips runtime has no system fonts. Fontconfig reads this
// before the first SVG is rasterized, including text-based merchant logos.
if (process.env.VERCEL && !process.env.FONTCONFIG_FILE) {
  process.env.FONTCONFIG_FILE = path.resolve("server/fonts/fonts.conf");
}
