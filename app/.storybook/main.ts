import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  // Decision 0192: the app's public folder holds its Pages rules (_headers with X-Frame-Options DENY
  // and the CSP placeholder, _redirects), which would blank every canvas in the manager's iframe.
  // viteFinal turns publicDir off; the favicon the manager and preview heads name is copied alone.
  staticDirs: [{ from: "../public/favicon.svg", to: "/favicon.svg" }],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal(config) {
    config.publicDir = false;
    config.server ??= {};
    config.server.strictPort = false;
    delete config.server.port;
    config.define = {
      ...config.define,
      "import.meta.env.VITE_FLOW_MCP_URL": JSON.stringify("https://example.com/functions/v1/flow-mcp"),
      // The build is public (FLOW-809): no hosted project or key from .env.production.
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("storybook-sample-anon-key"),
    };
    return config;
  },
};

export default config;
