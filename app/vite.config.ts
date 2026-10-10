import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { checkReviewerBundle } from "../scripts/check-prod-bundle.mjs";
import { rejectEmptyHostedSupabase } from "../scripts/hosted-env.mjs";

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
        throw new Error(`${bad.join("\n")}\nThe reviewers-only build must not contain a Flow Test 2 name, a golden id or total, or the hosted Supabase URL, anon key, or project ref.`);
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
      const index = path.join(dist, "index.html");
      // 404.html keeps a missing file at 404. Deep links are listed in app/public/_redirects
      // and serve this shell. A splat to /index.html is rejected by Pages as a loop.
      copyFileSync(index, path.join(dist, "404.html"));
      copyFileSync(index, path.join(dist, "app-shell"));
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
  // FLOW-813: the e2e build (playwright.config.ts) stands in for the dev server: no service
  // worker, and CSS as written, so a spec reads the same computed styles as in dev.
  const e2eBuild = process.env.FLOW_E2E_BUILD === "1";

  return {
    optimizeDeps: {
      // The books screens pull these in after sign-in. Pre-bundling them avoids a
      // mid-session reload while Vite discovers the query client and Supabase. Vaul is only
      // imported dynamically (FLOW-815), so without this a story run re-optimizes mid-run.
      include: ["@tanstack/react-query", "@supabase/supabase-js", "vaul"],
    },
    base: "/",
    resolve: {
      // FLOW-804: supabase-js builds a realtime and a storage client that Flow never uses.
      alias: [
        { find: /^@supabase\/realtime-js$/, replacement: path.resolve(__dirname, "src/lib/supabase-unused.ts") },
        { find: /^@supabase\/storage-js$/, replacement: path.resolve(__dirname, "src/lib/supabase-unused.ts") },
      ],
    },
    envDir: path.resolve(__dirname, ".."),
    ...(e2eBuild ? { build: { cssMinify: false } } : {}),
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
      tailwindcss(e2eBuild ? { optimize: false } : undefined),
      ...(storybook ? [] : [bundleGraph(), reviewerGuard()]),
      ...(storybook || e2eBuild
        ? []
        : [
            spaFallback(),
            VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      workbox: {
        navigateFallback: "/index.html",
        // FLOW-502: the push and notification-click handlers live beside the generated worker.
        importScripts: ["push-sw.js"],
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
