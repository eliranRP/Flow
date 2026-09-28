import type { Decorator, Preview } from "@storybook/react";
import { MemoryRouter } from "react-router-dom";
import "../src/styles/app.css";

const withFlow: Decorator = (Story, context) => {
  const theme = context.globals.theme === "dark" ? "dark" : "light";
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
  document.documentElement.dataset.theme = theme;
  return (
    <MemoryRouter>
      <div className="mx-auto min-h-dvh w-full max-w-content bg-bg text-text" dir="rtl" lang="he">
        <Story />
      </div>
    </MemoryRouter>
  );
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
