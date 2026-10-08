import type { Decorator, Preview } from "@storybook/react";
import { MemoryRouter } from "react-router-dom";
import "../src/styles/app.css";

const withFlow: Decorator = (Story, context) => {
  const theme = context.globals.theme === "dark" ? "dark" : "light";
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
  document.documentElement.dataset.theme = theme;
  const frame = (
    <div className="mx-auto min-h-dvh w-full max-w-content bg-bg text-text" dir="rtl" lang="he">
      <Story />
    </div>
  );
  // Route stories mount the real screens inside their own MemoryRouter.
  if (context.parameters.flowRouter === false) return frame;
  return <MemoryRouter>{frame}</MemoryRouter>;
};

const preview: Preview = {
  decorators: [withFlow],
  initialGlobals: {
    theme: "light",
    viewport: { value: "flow390", isRotated: false },
  },
  globalTypes: {
    theme: {
      description: "ערכת צבע",
      toolbar: {
        title: "ערכת צבע",
        icon: "circlehollow",
        items: [
          { value: "light", title: "בהיר" },
          { value: "dark", title: "כהה" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: "fullscreen",
    viewport: {
      viewports: {
        flow390: {
          name: "Flow 390",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
        flow320: {
          name: "Flow 320",
          styles: { width: "320px", height: "844px" },
          type: "mobile",
        },
        "flow375-se": {
          name: "Flow 375 SE",
          styles: { width: "375px", height: "667px" },
          type: "mobile",
        },
        flow393: {
          name: "Flow 393",
          styles: { width: "393px", height: "852px" },
          type: "mobile",
        },
        "flow390-short": {
          name: "Flow 390 short",
          styles: { width: "390px", height: "700px" },
          type: "mobile",
        },
      },
      defaultViewport: "flow390",
    },
    a11y: {
      test: "error",
      config: {
        rules: [
          { id: "heading-order", enabled: false },
          { id: "page-has-heading-one", enabled: false },
        ],
      },
    },
  },
};

export default preview;
