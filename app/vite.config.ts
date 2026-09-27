import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon.svg"],
      manifest: {
        name: "Flow",
        short_name: "Flow",
        description: "הרווח וההפסד של העסק, בלי אקסלים",
        lang: "he",
        dir: "rtl",
        display: "standalone",
        background_color: "#FFFFFF",
        theme_color: "#7B3FE4",
        start_url: "/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
});
