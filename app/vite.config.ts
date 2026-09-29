import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { checkReviewerBundle } from "../scripts/check-prod-bundle.mjs";
import { rejectEmptyHostedSupabase } from "../scripts/hosted-env.mjs";

/** Static hosts that only serve files: deep links fall back to index.html. */
/** Module ids of the production build. Written beside dist so the host never serves it. */
function bundleGraph(): Plugin {
  return {
    name: "flow-bundle-graph",
    apply: "build",
    generateBundle(_options, bundle) {
      const ids = new Set<string>();
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        for (const id of Object.keys(item.modules)) {
          if (!id.includes("\0")) ids.add(id);
        }
      }
      const target = path.resolve(__dirname, "bundle-graph.json");
      writeFileSync(target, JSON.stringify([...ids]));
    },
  };
}

function reviewerGuard(): Plugin {
  return {
    name: "flow-reviewer-guard",
    apply: "build",
    closeBundle() {
      if (process.env.VITE_REVIEWER_BUILD !== "1") return;
      const bad = checkReviewerBundle();
      if (bad.length > 0) {
        throw new Error(`${bad.join("\n")}\nThe reviewers-only build must not contain a Flow Test 2 name, a golden id or total, or the hosted Supabase URL or anon key.`);
      }
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
    // An explicit empty string stays empty. A reviewers-only build sets the
    // Supabase URL and anon key to "" so the hosted key is not filled in.
    if (process.env[key] == null) process.env[key] = value;
  }
  const emptyHosted = rejectEmptyHostedSupabase(process.env, process.env.VITE_REVIEWER_BUILD === "1");
  if (emptyHosted.length > 0) {
    throw new Error(`${emptyHosted.join("\n")}\nA hosted build needs the public client key. Unset the variable to use app/.env.production, or set VITE_REVIEWER_BUILD=1 for the reviewers-only build.`);
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
      ...(storybook ? [] : [bundleGraph(), reviewerGuard()]),
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
