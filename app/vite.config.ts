import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** Static hosts that only serve files: deep links fall back to index.html. */
/** Module ids of the production build. Written beside dist so the host never serves it. */
function bundleGraph(): Plugin {
  return {
    name: "flow-bundle-graph",
    apply: "build",
    generateBundle() {
      const ids = [...this.getModuleIds()].filter((id) => !id.includes("\0"));
      const target = path.resolve(__dirname, "bundle-graph.json");
      writeFileSync(target, JSON.stringify(ids));
    },
  };
}

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

  const lifecycle = process.env.npm_lifecycle_event ?? "";
  const storybook = Boolean(process.env.VITEST) || lifecycle.includes("storybook");

  return {
    optimizeDeps: {
      // The books screens pull these in after sign-in. Pre-bundling them avoids a
      // mid-session reload while Vite discovers the query client and Supabase.
      include: ["@tanstack/react-query", "@supabase/supabase-js"],
    },
    base: "/",
    envDir: path.resolve(__dirname, ".."),
    server: {
      host: "0.0.0.0",
      // Storybook and the story tests must not take the app's port.
      ...(storybook ? { strictPort: false } : { port: 43123, strictPort: true }),
      fs: {
        allow: [path.resolve(__dirname, "..")],
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      ...(storybook ? [] : [bundleGraph()]),
      ...(storybook
        ? []
        : [
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
          ]),
    ],
  };
});
