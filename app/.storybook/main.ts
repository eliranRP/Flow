import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-a11y", "@storybook/experimental-addon-test"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal(config) {
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
