import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useLayoutEffect, type ReactNode } from "react";
import { DemoPlayer } from "./demo-player";
import { longHebrew } from "./story-support";

function reducedMotionList(query: string): MediaQueryList {
  return {
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
    addListener: () => undefined,
    removeListener: () => undefined,
  };
}

let originalMatchMedia: typeof window.matchMedia | null = null;

function installReducedMotion() {
  if (originalMatchMedia) return;
  originalMatchMedia = window.matchMedia.bind(window);
  const previous = originalMatchMedia;
  window.matchMedia = (query: string) => {
    if (query.includes("prefers-reduced-motion")) return reducedMotionList(query);
    return previous(query);
  };
}

function uninstallReducedMotion() {
  if (!originalMatchMedia) return;
  window.matchMedia = originalMatchMedia;
  originalMatchMedia = null;
}

function ReducedMotionFrame({ children }: { children: ReactNode }) {
  installReducedMotion();
  useLayoutEffect(() => {
    return () => {
      uninstallReducedMotion();
    };
  }, []);
  return children;
}

const forceReducedMotion: Decorator = (Story) => (
  <ReducedMotionFrame>
    <Story />
  </ReducedMotionFrame>
);

function SampleScene({ title }: { title: string }) {
  return (
    <div className="ui-demo-scene">
      <p className="ui-demo-example t-hint">נתוני דוגמה · Example data</p>
      <div className="ui-demo-card ui-demo-slide">
        <p className="t-title-3">{title}</p>
        <p className="t-body">
          <bdi dir="ltr">₪1,200</bdi>
        </p>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/DemoPlayer",
  component: DemoPlayer,
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: "heading-order", enabled: false },
          { id: "page-has-heading-one", enabled: false },
          // COPY: the visible word is שוב and the accessible name is הצגה חוזרת.
          { id: "label-content-name-mismatch", enabled: false },
        ],
      },
    },
  },
  args: {
    alt: "הדגמה: מחברים את SUMIT, והתנועות נכנסות ללשונית לאישור.",
    durationMs: 4000,
    children: <SampleScene title="דוגמה בע״מ" />,
  },
} satisfies Meta<typeof DemoPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LastFrame: Story = {
  decorators: [forceReducedMotion],
};

export const Playing: Story = {
  args: { durationMs: 1200 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvasElement.querySelector(".ui-demo");
    await waitFor(() => expect(canvas.getByRole("button", { name: "הצגה חוזרת" })).toBeVisible(), { timeout: 3000 });
    await expect(root).toHaveAttribute("data-demo-state", "settled");
    await userEvent.click(canvas.getByRole("button", { name: "הצגה חוזרת" }));
    await expect(root).toHaveAttribute("data-demo-state", "playing");
    await expect(canvas.queryByRole("button", { name: "הצגה חוזרת" })).toBeNull();
    await waitFor(() => expect(root).toHaveAttribute("data-demo-state", "settled"), { timeout: 3000 });
  },
};

export const LongHebrew: Story = {
  decorators: [forceReducedMotion],
  args: {
    alt: longHebrew,
    children: <SampleScene title={longHebrew} />,
  },
};
