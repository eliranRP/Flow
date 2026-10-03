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
    };
    return config;
  },
};

export default config;
