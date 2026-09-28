import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** Static hosts that only serve files: deep links fall back to index.html. */
function spaFallback(): Plugin {
  return {
    name: "spa-fallback",
    apply: "build",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist");
      copyFileSync(path.join(dist, "index.html"), path.join(dist, "404.html"));
      writeFileSync(path.join(dist, "_redirects"), "/*  /index.html  200\n");
    },
  };
}

export default defineConfig(({ mode }) => {
  // Local .env stays at the repo root. The committed public client keys live in
  // app/.env.production and fill any VITE_ value the shell did not set.
  const appEnv = loadEnv(mode, __dirname, "VITE_");
  for (const [key, value] of Object.entries(appEnv)) {
    if (!process.env[key]) process.env[key] = value;
  }

  return {
  base: "/",
  envDir: path.resolve(__dirname, ".."),
  server: {
    host: "0.0.0.0",
    port: 43123,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    spaFallback(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      workbox: {
        navigateFallback: "/index.html",
      },
      manifest: {
        name: "Flow",
        short_name: "Flow",
        description: "הרווח וההפסד של העסק, בלי אקסלים",
        lang: "he",
        dir: "rtl",
        display: "standalone",
        orientation: "portrait",
        background_color: "#FFFFFF",
        theme_color: "#7B3FE4",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
};
});
