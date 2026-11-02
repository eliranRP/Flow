import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { checkReviewerBundle } from "../scripts/check-prod-bundle.mjs";
import { rejectEmptyHostedSupabase } from "../scripts/hosted-env.mjs";
import { buildCsp, fillCsp } from "../scripts/security-headers.mjs";

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

/** Decision 0192: the CSP in dist/_headers names the built index.html's inline script by hash. */
function securityHeaders(): Plugin {
  let dist = path.resolve(__dirname, "dist");
  return {
    name: "flow-security-headers",
    apply: "build",
    configResolved(config) {
      dist = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const html = readFileSync(path.join(dist, "index.html"), "utf8");
      const target = path.join(dist, "_headers");
      const csp = buildCsp({ html, supabaseUrl: process.env.VITE_SUPABASE_URL });
      writeFileSync(target, fillCsp(readFileSync(target, "utf8"), csp));
    },
  };
}

function spaFallback(): Plugin {
  // The build's own output folder: the e2e, perf and load-report builds write elsewhere than dist.
  let dist = path.resolve(__dirname, "dist");
  return {
    name: "spa-fallback",
    apply: "build",
    configResolved(config) {
      dist = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
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
        // Decision 0192: zod without its new Function probe, which the CSP (no 'unsafe-eval') reports.
        { find: /^zod$/, replacement: path.resolve(__dirname, "src/lib/zod-jitless.ts") },
      ],
    },
    envDir: path.resolve(__dirname, ".."),
    build: {
      ...(e2eBuild ? { cssMinify: false } : {}),
      rolldownOptions: {
        // Vite 8: rolldown splits what Home loads up front into one file per shared module, and
        // each file gzips on its own. One chunk for the up-front graph keeps Home one download, as on Vite 7.
        output: { codeSplitting: { groups: [{ name: "index", tags: ["$initial"] }] } },
      },
    },
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
      ...(storybook ? [] : [bundleGraph(), reviewerGuard(), securityHeaders()]),
      ...(storybook || e2eBuild
        ? []
        : [
            spaFallback(),
            VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      workbox: {
        // FLOW-843: launches came from the precached index.html, so the first one after a deploy
        // ran the old bundle every time. The page now comes from the network (all routes serve
        // the same shell) and the last one fetched is the offline copy, under one key. The
        // precached index.html stays only as the offline page before any launch has stored one:
        // no directory index, so "/" no longer matches it.
        navigateFallback: null,
        directoryIndex: null,
        globIgnores: ["404.html"],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "flow-shell",
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [200] },
              precacheFallback: { fallbackURL: "/index.html" },
              plugins: [{ cacheKeyWillBeUsed: () => Promise.resolve("/app-shell") }],
            },
          },
        ],
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
