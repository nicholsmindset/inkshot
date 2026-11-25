import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  // Never inline assets: the production CSP (font-src 'self') blocks data: fonts, which silently fell back to system fonts.
  build: { outDir: "dist", assetsInlineLimit: 0 },
});
